#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import tools from "./tools"

// Safe mode implementation - lazy loading of modules
let useEagerLoading = true
let loadingTimeout: NodeJS.Timeout | null = null
let safeModeFallback = false

console.error("Starting apple-mcp server...")

// Placeholders for modules - will either be loaded eagerly or lazily
let mail: typeof import("./utils/mail").default | null = null

// Type map for module names to their types
type ModuleMap = {
  mail: typeof import("./utils/mail").default
}

// Helper function for lazy module loading
async function loadModule<T extends "mail">(moduleName: T): Promise<ModuleMap[T]> {
  if (safeModeFallback) {
    console.error(`Loading ${moduleName} module on demand (safe mode)...`)
  }

  try {
    switch (moduleName) {
      case "mail":
        if (!mail) mail = (await import("./utils/mail")).default
        return mail as ModuleMap[T]
      default:
        throw new Error(`Unknown module: ${moduleName}`)
    }
  } catch (e) {
    console.error(`Error loading module ${moduleName}:`, e)
    throw e
  }
}

// Set a timeout to switch to safe mode if initialization takes too long
loadingTimeout = setTimeout(() => {
  console.error("Loading timeout reached. Switching to safe mode (lazy loading...)")
  useEagerLoading = false
  safeModeFallback = true

  // Clear the references to any modules that might be in a bad state
  mail = null

  // Proceed with server setup
  initServer()
}, 5000) // 5 second timeout

// Eager loading attempt
async function attemptEagerLoading() {
  try {
    console.error("Attempting to eagerly load modules...")

    // Try to import all modules
    mail = (await import("./utils/mail")).default
    console.error("- Mail module loaded successfully")

    // If we get here, clear the timeout and proceed with eager loading
    if (loadingTimeout) {
      clearTimeout(loadingTimeout)
      loadingTimeout = null
    }

    console.error("All modules loaded successfully, using eager loading mode")
    initServer()
  } catch (error) {
    console.error("Error during eager loading:", error)
    console.error("Switching to safe mode (lazy loading)...")

    // Clear any timeout if it exists
    if (loadingTimeout) {
      clearTimeout(loadingTimeout)
      loadingTimeout = null
    }

    // Switch to safe mode
    useEagerLoading = false
    safeModeFallback = true

    // Clear the references to any modules that might be in a bad state
    mail = null

    // Initialize the server in safe mode
    initServer()
  }
}

// Attempt eager loading first
attemptEagerLoading()

// Main server object
let server: Server

// Initialize the server and set up handlers
function initServer() {
  console.error(`Initializing server in ${safeModeFallback ? "safe" : "standard"} mode...`)

  server = new Server(
    {
      name: "Apple MCP tools",
      version: "1.0.0", // Consider bumping version after significant changes
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params

      if (!args) {
        throw new Error("No arguments provided")
      }

      switch (name) {
        case "createDraft": {
          if (!isCreateDraftArgs(args)) {
            throw new Error("Invalid arguments for createDraft tool")
          }

          try {
            const mailModule = await loadModule("mail")
            if (args.isReply && !args.originalMessageId) {
              throw new Error("originalMessageId is required when isReply is true.")
            }
            const result = await mailModule.createDraftEmail(
              args.isReply,
              args.originalMessageId || null,
              args.toAddress || null,
              args.subject,
              args.body,
              args.attachmentPath || null,
            )
            return {
              content: [{ type: "text", text: result.message }],
              isError: !result.success,
              ...(result.draftId && { draftId: result.draftId }),
            }
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error with createDraft operation: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            }
          }
        }

        case "listEmails": {
          if (!isListEmailsArgs(args)) {
            throw new Error("Invalid arguments for listEmails tool")
          }

          try {
            const mailModule = await loadModule("mail")
            const emails = await mailModule.listEmails({
              searchTerm: args.searchTerm,
              limit: args.limit,
              accountName: args.accountName,
              mailboxName: args.mailboxName,
              isRead: args.isRead,
              isFlagged: args.isFlagged,
            })
            return {
              content: [
                {
                  type: "text",
                  text:
                    emails.length > 0
                      ? `Found ${emails.length} email(s)${args.searchTerm ? ` matching "${args.searchTerm}"` : ""}:\n\n` +
                        emails
                          .map(
                            (email) =>
                              `ID: ${email.messageId}\nFrom: ${email.sender}\nSubject: ${email.subject}\nDate: ${email.dateReceived}\nMailbox: ${email.account} - ${email.mailbox}\nRead: ${email.isRead}\nFlagged: ${email.isFlagged}`,
                          )
                          .join("\n\n---\n\n")
                      : `No emails found${args.searchTerm ? ` for "${args.searchTerm}"` : ""}`,
                },
              ],
              isError: false,
            }
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error with listEmails operation: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            }
          }
        }

        case "readEmails": {
          if (!isReadEmailsArgs(args)) {
            throw new Error("Invalid arguments for readEmails tool")
          }

          try {
            const mailModule = await loadModule("mail")
            // Ensure ReadEmailRequest in index.ts matches the one in mail.ts for the call
            const results = await mailModule.readEmails(args.readRequests.map(req => ({
              messageId: req.messageId,
              account: (req as any).account, // Cast to any if account/mailbox not in schema yet
              mailbox: (req as any).mailbox, // Cast to any if account/mailbox not in schema yet
            })))

            let responseText = `Read ${results.length} email(s):\n\n`
            results.forEach((email, index) => {
              responseText += `${index + 1}. ${email.success ? "✓" : "✗"} ${email.subject}\n`
              if (email.success) {
                responseText += `   Message ID: ${email.messageId}\n`
                responseText += `   From: ${email.sender}\n`
                responseText += `   Date: ${email.dateReceived}\n`
                if (email.account && email.mailbox) {
                  responseText += `   Mailbox: ${email.account} - ${email.mailbox}\n`
                }
                responseText += `   Read: ${email.isRead}\n`
                responseText += `   Flagged: ${email.isFlagged}\n`
                responseText += `   Content:\n${email.content}\n`
                if (email.links && email.links.length > 0) {
                  responseText += `   Links:\n`
                  email.links.forEach(link => {
                    responseText += `     - Text: ${link.body}, URL: ${link.href}\n`
                  })
                }
                // Optionally include source, can be very long.
                // responseText += `   Source:\n${email.source}\n` 
              } else {
                responseText += `   Error: ${email.error}\n`
              }
              responseText += "\n"
            })

            return {
              content: [{ type: "text", text: responseText }],
              isError: results.some((r) => !r.success),
            }
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error with readEmails operation: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            }
          }
        }

        case "listMailboxes": {
          try {
            const mailModule = await loadModule("mail")
            const mailboxes = await mailModule.listMailboxes()
            return {
              content: [
                {
                  type: "text",
                  text:
                    mailboxes.length > 0
                      ? `Found ${mailboxes.length} mailbox(es):\n\n${mailboxes.map((mb) => `${mb.account}/${mb.mailbox}`).join("\n")}`
                      : `No mailboxes found.`,
                },
              ],
              isError: false,
            }
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error with listMailboxes operation: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            }
          }
        }

        case "archive": {
          if (!isArchiveArgs(args)) {
            throw new Error("Invalid arguments for archive tool")
          }

          try {
            const mailModule = await loadModule("mail")
            const result = await mailModule.archiveEmails({ messageId: args.messageId })

            return {
              content: [{ type: "text", text: result.message }],
              isError: !result.success,
            }
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error with archive operation: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            }
          }
        }

        case "copy": {
          if (!isCopyArgs(args)) {
            throw new Error("Invalid arguments for copy tool")
          }

          try {
            const mailModule = await loadModule("mail")
            const result = await mailModule.copyEmails({
              messageId: args.messageId,
              targetMailboxName: args.targetMailboxName,
              targetAccountName: args.targetAccountName,
            })

            return {
              content: [{ type: "text", text: result.message }],
              isError: !result.success,
            }
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error with copy operation: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            }
          }
        }

        case "move": {
          if (!isMoveArgs(args)) {
            throw new Error("Invalid arguments for move tool")
          }

          try {
            const mailModule = await loadModule("mail")
            const result = await mailModule.moveEmails({
              messageId: args.messageId,
              targetMailboxName: args.targetMailboxName,
              targetAccountName: args.targetAccountName,
            })

            return {
              content: [{ type: "text", text: result.message }],
              isError: !result.success,
            }
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error with move operation: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            }
          }
        }

        case "trash": {
          if (!isTrashArgs(args)) {
            throw new Error("Invalid arguments for trash tool")
          }

          try {
            const mailModule = await loadModule("mail")
            const result = await mailModule.trashEmails({ messageId: args.messageId })

            return {
              content: [{ type: "text", text: result.message }],
              isError: !result.success,
            }
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error with trash operation: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            }
          }
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          }
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  })

  // Start the server transport
  console.error("Setting up MCP server transport...")
  ;(async () => {
    try {
      console.error("Initializing transport...")
      const transport = new StdioServerTransport()

      // Ensure stdout is only used for JSON messages
      console.error("Setting up stdout filter...")
      const originalStdoutWrite = process.stdout.write.bind(process.stdout)
      process.stdout.write = (chunk: any, encoding?: any, callback?: any) => {
        // Only allow JSON messages to pass through
        if (typeof chunk === "string" && !chunk.startsWith("{")) {
          // console.error("Filtering non-JSON stdout message"); // Removed to reduce noise
          return true // Silently skip non-JSON messages
        }
        return originalStdoutWrite(chunk, encoding, callback)
      }

      console.error("Connecting transport to server...")
      await server.connect(transport)
      console.error("Server connected successfully!")
    } catch (error) {
      console.error("Failed to initialize MCP server:", error)
      process.exit(1)
    }
  })()
}

// Helper functions for argument type checking
// Removed isContactsArgs function

// Define EmailMessage interface here or import from mail.ts if it's exported
interface EmailMessage {
  account?: string
  mailbox?: string
  messageId: string
  subject: string
  sender: string
  dateReceived?: string
  isRead?: boolean
  isFlagged?: boolean
  content?: string
}

interface MoveEmailRequest {
  messageId: string
  targetMailboxName: string
  targetAccountName: string
}

interface TrashEmailRequest {
  messageId: string
}

interface ArchiveEmailRequest {
  messageId: string
}

// Removed isCalendarArgs function

type ArchiveArgs = {
  messageId: string
}

function isArchiveArgs(args: unknown): args is ArchiveArgs {
  if (typeof args !== "object" || args === null) {
    return false
  }

  const { messageId } = args as { messageId?: unknown }

  return typeof messageId === "string"
}

type CopyArgs = {
  messageId: string
  targetMailboxName: string
  targetAccountName: string
}

function isCopyArgs(args: unknown): args is CopyArgs {
  if (typeof args !== "object" || args === null) {
    return false
  }

  const { messageId, targetMailboxName, targetAccountName } = args as CopyArgs

  return (
    typeof messageId === "string" &&
    typeof targetMailboxName === "string" &&
    typeof targetAccountName === "string"
  )
}

interface ReadEmailRequest {
  messageId: string
  // These are now part of the tool's input schema, so they should be defined here too.
  account?: string 
  mailbox?: string
}

type CreateDraftArgs = {
  isReply: boolean
  originalMessageId?: string
  toAddress?: string
  subject: string
  body: string
  attachmentPath?: string
}

function isCreateDraftArgs(args: unknown): args is CreateDraftArgs {
  if (typeof args !== "object" || args === null) {
    return false
  }

  const { isReply, subject, body } = args as CreateDraftArgs
  if (typeof isReply !== "boolean" || typeof subject !== "string" || typeof body !== "string")
    return false

  const { originalMessageId } = args as CreateDraftArgs
  if (isReply && typeof originalMessageId !== "string") return false

  return true
}

type ListEmailsArgs = {
  searchTerm?: string
  limit?: number
  accountName?: string
  mailboxName?: string
  isRead?: boolean
  isFlagged?: boolean
}

function isListEmailsArgs(args: unknown): args is ListEmailsArgs {
  if (typeof args !== "object" || args === null) {
    return false
  }

  const { searchTerm, limit, accountName, mailboxName, isRead, isFlagged } = args as ListEmailsArgs
  if (searchTerm && typeof searchTerm !== "string") return false
  if (limit && typeof limit !== "number") return false
  if (accountName && typeof accountName !== "string") return false
  if (mailboxName && typeof mailboxName !== "string") return false
  if (isRead !== undefined && typeof isRead !== "boolean") return false
  if (isFlagged !== undefined && typeof isFlagged !== "boolean") return false

  return true
}

type ReadEmailsArgs = {
  readRequests: ReadEmailRequest[]
}

function isReadEmailsArgs(args: unknown): args is ReadEmailsArgs {
  if (typeof args !== "object" || args === null) {
    return false
  }

  const { readRequests } = args as { readRequests?: unknown }

  if (!Array.isArray(readRequests) || readRequests.length === 0) return false

  return readRequests.every((req) => {
    if (typeof req !== "object" || req === null) return false;
    const r = req as any; // Use 'as any' to check for optional properties
    if (typeof r.messageId !== "string") return false;
    if (r.account !== undefined && typeof r.account !== "string") return false;
    if (r.mailbox !== undefined && typeof r.mailbox !== "string") return false;
    return true;
  });
}

type MoveArgs = {
  messageId: string
  targetMailboxName: string
  targetAccountName: string
}

function isMoveArgs(args: unknown): args is MoveArgs {
  if (typeof args !== "object" || args === null) {
    return false
  }

  const { messageId, targetMailboxName, targetAccountName } = args as MoveArgs

  return (
    typeof messageId === "string" &&
    typeof targetMailboxName === "string" &&
    typeof targetAccountName === "string"
  )
}

type TrashArgs = {
  messageId: string
}

function isTrashArgs(args: unknown): args is TrashArgs {
  if (typeof args !== "object" || args === null) {
    return false
  }

  const { messageId } = args as { messageId?: unknown }

  return typeof messageId === "string"
}
