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
        case "mail": {
          if (!isMailArgs(args)) {
            throw new Error("Invalid arguments for mail tool")
          }

          try {
            const mailModule = await loadModule("mail")

            switch (args.operation) {
              case "createDraft": {
                if (typeof args.isReply !== "boolean" || !args.subject || !args.body) {
                  throw new Error(
                    "isReply, subject, and body are required for createDraft operation.",
                  )
                }
                if (args.isReply && !args.originalMessageId) {
                  throw new Error("originalMessageId is required when isReply is true.")
                }
                // No specific check for toAddress as it can be optional for a draft
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
              }
              case "list": {
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
              }
              case "read": {
                if (!args.messageId) {
                  throw new Error("messageId is required for read operation.")
                }
                const email = await mailModule.readEmail(args.messageId)
                if (email) {
                  return {
                    content: [
                      {
                        type: "text",
                        text: `Email Details (ID: ${email.messageId}):\nFrom: ${email.sender}\nSubject: ${email.subject}\nDate: ${email.dateReceived}\nMailbox: ${email.account} - ${email.mailbox}\nRead: ${email.isRead}\nFlagged: ${email.isFlagged}\n\nContent:\n${email.content}`,
                      },
                    ],
                    isError: false,
                  }
                } else {
                  return {
                    content: [
                      {
                        type: "text",
                        text: `Could not find or read email with ID: ${args.messageId}`,
                      },
                    ],
                    isError: true,
                  }
                }
              }
              case "move": {
                if (!args.moveRequests || !Array.isArray(args.moveRequests) || args.moveRequests.length === 0) {
                  throw new Error(
                    "moveRequests array is required for move operation and must contain at least one request.",
                  )
                }
                const result = await mailModule.moveEmail(args.moveRequests)
                
                // Format the detailed response
                let responseText = result.message + "\n\n"
                if (result.movedEmails.length > 0) {
                  responseText += "Details:\n"
                  result.movedEmails.forEach((email, index) => {
                    responseText += `${index + 1}. ${email.success ? "✓" : "✗"} ${email.subject}\n`
                    responseText += `   From: ${email.sender}\n`
                    responseText += `   Date: ${email.dateReceived}\n`
                    responseText += `   Moved from: ${email.sourceAccount} - ${email.sourceMailbox}\n`
                    responseText += `   Moved to: ${email.targetAccount} - ${email.targetMailbox}\n`
                    if (!email.success && email.error) {
                      responseText += `   Error: ${email.error}\n`
                    }
                    responseText += "\n"
                  })
                }
                
                return {
                  content: [{ type: "text", text: responseText }],
                  isError: !result.success,
                }
              }
              case "listMailboxes": {
                const mailboxes = await mailModule.listMailboxes()
                return {
                  content: [
                    {
                      type: "text",
                      text:
                        mailboxes.length > 0
                          ? `Found ${mailboxes.length} mailbox(es):\n\n${mailboxes.map(mb => `${mb.account}/${mb.mailbox}`).join("\n")}`
                          : `No mailboxes found.`,
                    },
                  ],
                  isError: false,
                }
              }
              default:
                // @ts-expect-error - args.operation might be an invalid string here
                throw new Error(`Unknown mail operation: ${args.operation}`)
            }
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error with mail operation: ${error instanceof Error ? error.message : String(error)}`,
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

type MailArgs =
  | {
      operation: "createDraft"
      isReply: boolean
      originalMessageId?: string
      toAddress?: string
      subject: string
      body: string
      attachmentPath?: string
      searchTerm?: never
      limit?: never
      moveRequests?: never
      targetMailboxName?: never
      targetAccountName?: never
      accountName?: never
      mailboxName?: never
      isRead?: never
      isFlagged?: never
    }
  | {
      operation: "list"
      searchTerm?: string
      limit?: number
      accountName?: string
      mailboxName?: string
      isRead?: boolean
      isFlagged?: boolean
      isReply?: never
      originalMessageId?: never
      toAddress?: never
      subject?: never
      body?: never
      attachmentPath?: never
      moveRequests?: never
      targetMailboxName?: never
      targetAccountName?: never
    }
  | {
      operation: "read"
      messageId: string
      searchTerm?: never
      limit?: never
      isReply?: never
      originalMessageId?: never
      toAddress?: never
      subject?: never
      body?: never
      attachmentPath?: never
      targetMailboxName?: never
      targetAccountName?: never
      accountName?: never
      mailboxName?: never
      isRead?: never
      isFlagged?: never
      moveRequests?: never
    }
  | {
      operation: "move"
      moveRequests: MoveEmailRequest[]
      searchTerm?: never
      limit?: never
      isReply?: never
      originalMessageId?: never
      toAddress?: never
      subject?: never
      body?: never
      attachmentPath?: never
      accountName?: never
      mailboxName?: never
      isRead?: never
      isFlagged?: never
      targetMailboxName?: never
      targetAccountName?: never
    }
  | {
      operation: "listMailboxes"
      searchTerm?: never
      limit?: never
      isReply?: never
      originalMessageId?: never
      toAddress?: never
      subject?: never
      body?: never
      attachmentPath?: never
      moveRequests?: never
      targetMailboxName?: never
      targetAccountName?: never
      mailboxName?: never
      isRead?: never
      isFlagged?: never
      accountName?: never
    }

function isMailArgs(args: unknown): args is MailArgs {
  if (typeof args !== "object" || args === null) {
    return false
  }

  const { operation } = args as { operation?: string }

  if (!operation || !["createDraft", "list", "read", "move", "listMailboxes"].includes(operation)) {
    return false
  }

  switch (operation) {
    case "createDraft":
      const { isReply, subject, body } = args as MailArgs & { operation: "createDraft" }
      if (typeof isReply !== "boolean" || typeof subject !== "string" || typeof body !== "string")
        return false
      if (
        isReply &&
        typeof (args as MailArgs & { operation: "createDraft" }).originalMessageId !== "string"
      )
        return false
      break
    case "list":
      const { searchTerm, limit, accountName, mailboxName, isRead, isFlagged } =
        args as MailArgs & { operation: "list" }
      if (searchTerm && typeof searchTerm !== "string") return false
      if (limit && typeof limit !== "number") return false
      if (accountName && typeof accountName !== "string") return false
      if (mailboxName && typeof mailboxName !== "string") return false
      if (isRead !== undefined && typeof isRead !== "boolean") return false
      if (isFlagged !== undefined && typeof isFlagged !== "boolean") return false
      break
    case "read":
      const { messageId } = args as MailArgs & { operation: "read" }
      if (typeof messageId !== "string") return false
      break
    case "move":
      const { moveRequests } = args as MailArgs & { operation: "move" }
      if (!Array.isArray(moveRequests) || moveRequests.length === 0) return false
      if (!moveRequests.every(req => 
        typeof req === "object" && 
        typeof req.messageId === "string" && 
        typeof req.targetMailboxName === "string" && 
        typeof req.targetAccountName === "string"
      )) return false
      break
    case "listMailboxes":
      // No arguments to validate for listMailboxes anymore, as accountName is removed.
      // const { accountName: listMbAccountNameFromArgs } = args as MailArgs & { operation: "listMailboxes" };
      // if (listMbAccountNameFromArgs && typeof listMbAccountNameFromArgs !== "string") return false;
      break
    default:
      // This case should ideally not be reached if the operation is one of the valid enum values
      // and all valid operations are handled above.
      // If it's a valid operation string but not handled above, it's a logic error in this function.
      // If it's an invalid operation string, the initial check `!["createDraft", "list", "read", "move", "listMailboxes"].includes(operation)`
      // should have caught it.
      // For safety, returning false, but this indicates a potential issue if a valid op reaches here.
      return false
  }

  return true
}

// Removed isCalendarArgs function
