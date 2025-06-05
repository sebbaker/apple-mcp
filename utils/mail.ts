import Fuse from "fuse.js"
import { run } from "@jxa/run"
import { runAppleScript } from "run-applescript"

async function checkMailAccess(): Promise<boolean> {
  try {
    // First check if Mail is running
    const isRunning = await run<boolean>(() => {
      // The @ts-expect-error directive was here, removing it.
      return Application("System Events").applicationProcesses["Mail.app"].exists()
    })

    if (!isRunning) {
      console.error("Mail app is not running, attempting to launch...")
      try {
        await run(() => {
          const Mail = Application("Mail")
          Mail.activate()
          delay(2) // JXA delay is in seconds
        })
      } catch (activateError) {
        console.error("Error activating Mail app:", activateError)
        throw new Error("Could not activate Mail app. Please start it manually.")
      }
    }
    return true
  } catch (error) {
    console.error("Mail access check failed:", error)
    throw new Error(
      `Cannot access Mail app. Please make sure Mail is running and properly configured. Error: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

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

interface ListEmailsParams {
  searchTerm?: string
  limit?: number
  accountName?: string
  mailboxName?: string
  isRead?: boolean
  isFlagged?: boolean
}

interface MailboxEntry {
  account: string
  mailbox: string
}

async function createDraftEmail(
  isReply: boolean,
  originalMessageId: string | null,
  toAddress: string | null,
  subjectText: string,
  bodyText: string,
  attachmentPath: string | null,
): Promise<{ success: boolean; message: string; draftId?: string }> {
  try {
    if (!(await checkMailAccess())) {
      return { success: false, message: "Mail app not accessible." }
    }

    const result = await run<{ success: boolean; message: string; draftId?: string }>(
      (
        isReplyArg: boolean,
        originalMessageIdArg: string | null,
        toAddressArg: string | null,
        subjectTextArg: string,
        bodyTextArg: string,
        attachmentPathArg: string | null,
      ) => {
        const Mail = Application("Mail")
        Mail.activate()
        let theDraft: any // JXA Mail draft object

        if (isReplyArg) {
          if (!originalMessageIdArg) {
            return { success: false, message: "Original message ID is required for a reply." }
          }
          let foundMessage: any // JXA Mail message object
          const allAccounts = Mail.accounts()
          for (const currentAccount of allAccounts) {
            if (foundMessage) break
            const allMailboxes = currentAccount.mailboxes()
            for (const mbox of allMailboxes) {
              if (foundMessage) break
              try {
                const msgs = mbox.messages.whose({ messageId: originalMessageIdArg })()
                if (msgs.length > 0) {
                  foundMessage = msgs[0]
                  break
                }
              } catch (e) {
                // ignore
              }
            }
          }

          if (!foundMessage) {
            return {
              success: false,
              message: `Could not find original message with ID: ${originalMessageIdArg}`,
            }
          }
          theDraft = Mail.reply(foundMessage, { openingWindow: true })
          delay(0.7) // Initial delay to allow Mail to set up the reply

          let existingContent = ""
          const maxRetries = 3
          const retryDelay = 0.5 // 500ms between retries

          for (let i = 0; i < maxRetries; i++) {
            try {
              existingContent = theDraft.content() || ""
              if (existingContent.trim() !== "") {
                // Ensure content is not just whitespace
                break // Successfully got non-empty content
              }
            } catch (e: any) {
              console.log(
                `Attempt ${i + 1} to read draft content failed: ${e.message || String(e)}`,
              )
              if (i === maxRetries - 1) {
                console.log("Failed to read draft content after all retries.")
              }
            }
            if (i < maxRetries - 1) {
              // Don't delay after the last attempt
              delay(retryDelay)
            }
          }

          // Log warning if content is still empty after all retries
          if (existingContent.trim() === "") {
            console.warn(
              "Warning: Replying with empty original message content. Mail.reply() may not have populated content yet.",
            )
          }

          // Convert bodyTextArg to HTML format for proper prepending
          // Basic HTML escaping to prevent bodyTextArg from being interpreted as HTML tags
          const escapedBodyTextArg = bodyTextArg
            .replace(/&/g, "&")
            .replace(/</g, "&lt;")
            .replace(/>/g, ">")
          const htmlBodyTextArg = escapedBodyTextArg.replace(/\n/g, "<br>")

          // Use HTML line breaks for separation to ensure proper prepending in Mail's rich text content
          theDraft.content = htmlBodyTextArg + "<br><br>" + existingContent
        } else {
          theDraft = Mail.OutgoingMessage().make()
          theDraft.visible = true
          theDraft.subject = subjectTextArg
          theDraft.content = bodyTextArg
          if (toAddressArg) {
            theDraft.toRecipients.push(Mail.Recipient({ address: toAddressArg }))
          }
        }

        if (attachmentPathArg) {
          try {
            const attachmentFile = Path(attachmentPathArg) // JXA Path object
            theDraft.attachments.push(Mail.Attachment({ fileName: attachmentFile }))
          } catch (errMsg: any) {
            return {
              success: false,
              message: `Attachment error: ${errMsg.message || String(errMsg)}`,
            }
          }
        }
        delay(0.5) // Give Mail a moment to save
        return { success: true, message: "Draft created successfully.", draftId: theDraft.id() }
      },
      isReply,
      originalMessageId,
      toAddress,
      subjectText,
      bodyText,
      attachmentPath,
    )
    return result
  } catch (error) {
    console.error("Error in createDraftEmail:", error)
    return {
      success: false,
      message: `Error creating draft email: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function listEmails({
  searchTerm,
  limit,
  accountName: targetAccountName,
  mailboxName: targetMailboxName,
  isRead: filterIsRead,
  isFlagged: filterIsFlagged,
}: ListEmailsParams): Promise<EmailMessage[]> {
  try {
    if (!(await checkMailAccess())) {
      return []
    }

    // Get all available mailboxes for validation
    const allMailboxesRaw = await listMailboxes()

    // Validate account and mailbox names if provided
    if (targetAccountName) {
      const accountExists = allMailboxesRaw.some((mb) => mb.account === targetAccountName)
      if (!accountExists) {
        throw new Error(
          `Account "${targetAccountName}" not found. Available accounts: ${[...new Set(allMailboxesRaw.map((mb) => mb.account))].join(", ")}`,
        )
      }
    }

    if (targetMailboxName) {
      const mailboxExists = allMailboxesRaw.some((mb) =>
        targetAccountName
          ? mb.account === targetAccountName && mb.mailbox === targetMailboxName
          : mb.mailbox === targetMailboxName,
      )
      if (!mailboxExists) {
        const availableMailboxes = targetAccountName
          ? allMailboxesRaw.filter((mb) => mb.account === targetAccountName).map((mb) => mb.mailbox)
          : [...new Set(allMailboxesRaw.map((mb) => mb.mailbox))]
        throw new Error(
          `Mailbox "${targetMailboxName}" not found${targetAccountName ? ` in account "${targetAccountName}"` : ""}. Available mailboxes: ${availableMailboxes.join(", ")}`,
        )
      }
    }

    const getEmailsFromMailboxJXA = async (
      account: string,
      mailbox: string,
    ): Promise<EmailMessage[]> => {
      return run<EmailMessage[]>(
        (accountNameArg: string, mailboxNameArg: string) => {
          const Mail = Application("Mail")
          const specificEmails: EmailMessage[] = []

          try {
            const theAccount = Mail.accounts.byName(accountNameArg)
            if (!theAccount.exists() || !theAccount.enabled()) {
              return []
            }

            const theMailbox = theAccount.mailboxes.byName(mailboxNameArg)
            if (!theMailbox.exists()) {
              return []
            }
            let messagesToProcess = theMailbox.messages()
            const messageCount = messagesToProcess.length

            if (messageCount > 200) {
              messagesToProcess = messagesToProcess.slice(0, 200)
            }

            for (const msg of messagesToProcess) {
              try {
                const emailRecord: Partial<EmailMessage> = {
                  account: accountNameArg,
                  mailbox: mailboxNameArg,
                }
                emailRecord.messageId = msg.messageId()
                emailRecord.subject = msg.subject() || "[No Subject]" // subject is a function
                emailRecord.sender = msg.sender() || "[Unknown Sender]"
                const dateReceived = msg.dateReceived()
                emailRecord.dateReceived = dateReceived ? dateReceived.toISOString() : undefined
                emailRecord.isRead = msg.readStatus()
                emailRecord.isFlagged = msg.flaggedStatus()
                specificEmails.push(emailRecord as EmailMessage)
              } catch (e) {
                // console.log("Error processing a message: " + e);
              }
            }
          } catch (e) {
            // console.log(`Error accessing mailbox '${mailboxNameArg}' in account '${accountNameArg}': ${e}`);
            return []
          }
          return specificEmails
        },
        account,
        mailbox,
      )
    }

    let mailboxesToFetch: { account: string; mailbox: string }[] = []

    if (targetAccountName && targetMailboxName) {
      mailboxesToFetch.push({ account: targetAccountName, mailbox: targetMailboxName })
    } else if (targetAccountName && !targetMailboxName) {
      const matchingInboxName = allMailboxesRaw
        .filter((mb) => mb.account === targetAccountName && mb.mailbox.toLowerCase() === "inbox")
        .pop()?.mailbox

      if (!matchingInboxName) {
        throw new Error(
          `No inbox found in account '${targetAccountName}'. Available mailboxes: ${allMailboxesRaw
            .filter((mb) => mb.account === targetAccountName)
            .map((mb) => mb.mailbox)
            .join(", ")}`,
        )
      }
      mailboxesToFetch.push({ account: targetAccountName, mailbox: matchingInboxName })
    } else {
      if (targetMailboxName) {
        allMailboxesRaw.forEach((accMbox) => {
          if (accMbox.mailbox.toLowerCase() === targetMailboxName.toLowerCase()) {
            mailboxesToFetch.push(accMbox)
          }
        })
      } else {
        allMailboxesRaw.forEach((accMbox) => {
          if (accMbox.mailbox.toLowerCase() === "inbox") {
            mailboxesToFetch.push(accMbox)
          }
        })
      }
    }

    mailboxesToFetch = mailboxesToFetch.filter(
      (mb, index, self) =>
        index === self.findIndex((t) => t.account === mb.account && t.mailbox === mb.mailbox),
    )

    if (mailboxesToFetch.length === 0) {
      console.warn("No mailboxes identified to fetch emails from.")
      return []
    }

    const emailPromises = mailboxesToFetch.map((mb) =>
      getEmailsFromMailboxJXA(mb.account, mb.mailbox),
    )
    const resultsByMailbox = await Promise.all(emailPromises)
    let allEmails = resultsByMailbox.flat()

    // Deduplicate emails by messageId
    const seenMessageIds = new Set<string>()
    allEmails = allEmails.filter((email) => {
      if (seenMessageIds.has(email.messageId)) {
        return false
      }
      seenMessageIds.add(email.messageId)
      return true
    })

    allEmails.sort((a, b) => {
      const dateA = a.dateReceived ? new Date(a.dateReceived).getTime() : 0
      const dateB = b.dateReceived ? new Date(b.dateReceived).getTime() : 0
      return dateB - dateA
    })

    if (searchTerm && searchTerm.trim() !== "") {
      const fuse = new Fuse(allEmails, {
        keys: ["subject", "sender"],
        includeScore: true,
        threshold: 0.2,
        isCaseSensitive: false,
      })
      allEmails = fuse.search(searchTerm).map((result) => result.item)
    }

    if (typeof filterIsRead === "boolean") {
      allEmails = allEmails.filter((email) => email.isRead === filterIsRead)
    }

    if (typeof filterIsFlagged === "boolean") {
      allEmails = allEmails.filter((email) => email.isFlagged === filterIsFlagged)
    }

    return limit ? allEmails.slice(0, limit) : allEmails
  } catch (error) {
    console.error("Error in listEmails:", error)
    throw new Error(
      `Error listing emails: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

interface ReadEmailRequest {
  messageId: string
}

interface ReadEmailDetails {
  messageId: string
  account?: string
  mailbox?: string
  subject: string
  sender: string
  dateReceived?: string
  isRead?: boolean
  isFlagged?: boolean
  content?: string
  success: boolean
  error?: string
}

async function readEmails(readRequests: ReadEmailRequest[]): Promise<ReadEmailDetails[]> {
  try {
    if (!(await checkMailAccess())) {
      return readRequests.map((req) => ({
        messageId: req.messageId,
        subject: "",
        sender: "",
        success: false,
        error: "Mail app not accessible.",
      }))
    }

    // Deduplicate read requests by messageId
    const seenMessageIds = new Set<string>()
    const uniqueReadRequests = readRequests.filter((req) => {
      if (seenMessageIds.has(req.messageId)) {
        return false
      }
      seenMessageIds.add(req.messageId)
      return true
    })

    // Read messages in parallel
    const readMessage = async (request: ReadEmailRequest): Promise<ReadEmailDetails> => {
      return run<ReadEmailDetails>((msgId: string) => {
        const Mail = Application("Mail")

        const allAccounts = Mail.accounts()
        for (const currentAccount of allAccounts) {
          if (!currentAccount.enabled()) continue

          const allMailboxes = currentAccount.mailboxes()
          for (const currentMailbox of allMailboxes) {
            try {
              const msgs = currentMailbox.messages.whose({ messageId: msgId })()
              if (msgs.length > 0) {
                const msg = msgs[0]
                const dateReceived = msg.dateReceived()
                return {
                  messageId: msgId,
                  account: currentAccount.name(),
                  mailbox: currentMailbox.name(),
                  subject: msg.subject() || "[No Subject]",
                  sender: msg.sender() || "[Unknown Sender]",
                  dateReceived: dateReceived ? dateReceived.toISOString() : undefined,
                  isRead: msg.readStatus(),
                  isFlagged: msg.flaggedStatus(),
                  content: msg.content(),
                  success: true,
                }
              }
            } catch (e) {
              // ignore and continue
            }
          }
        }
        return {
          messageId: msgId,
          subject: "",
          sender: "",
          success: false,
          error: `Could not find or read email with ID: ${msgId}`,
        }
      }, request.messageId)
    }

    // Read all unique messages in parallel
    const readPromises = uniqueReadRequests.map((request) => readMessage(request))
    const readResults = await Promise.all(readPromises)

    return readResults
  } catch (error) {
    console.error("Error in readEmails:", error)
    return readRequests.map((req) => ({
      messageId: req.messageId,
      subject: "",
      sender: "",
      success: false,
      error: `Error reading emails: ${error instanceof Error ? error.message : String(error)}`,
    }))
  }
}

interface MoveEmailRequest {
  messageId: string
  targetMailboxName: string
  targetAccountName: string
}

interface MovedEmailDetails {
  messageId: string
  success: boolean
  error?: string
}

async function moveEmails(
  moveRequest: MoveEmailRequest,
): Promise<{ success: boolean; message: string; movedEmail: MovedEmailDetails }> {
  try {
    if (!(await checkMailAccess())) {
      return {
        success: false,
        message: "Mail app not accessible.",
        movedEmail: {
          messageId: moveRequest.messageId,
          success: false,
          error: "Mail app not accessible.",
        },
      }
    }

    // Get all available mailboxes for validation
    const allMailboxes = await listMailboxes()
    const validMailboxes = new Set(allMailboxes.map((mb) => `${mb.account}/${mb.mailbox}`))

    // Validate target mailbox before attempting move
    const targetKey = `${moveRequest.targetAccountName}/${moveRequest.targetMailboxName}`
    if (!validMailboxes.has(targetKey)) {
      const availableAccounts = [...new Set(allMailboxes.map((mb) => mb.account))]
      const availableMailboxesForAccount = allMailboxes
        .filter((mb) => mb.account === moveRequest.targetAccountName)
        .map((mb) => mb.mailbox)

      const errorMessage =
        availableMailboxesForAccount.length > 0
          ? `Mailbox "${moveRequest.targetMailboxName}" not found in account "${moveRequest.targetAccountName}". Available mailboxes: ${availableMailboxesForAccount.join(", ")}`
          : `Account "${moveRequest.targetAccountName}" not found. Available accounts: ${availableAccounts.join(", ")}`

      return {
        success: false,
        message: errorMessage,
        movedEmail: {
          messageId: moveRequest.messageId,
          success: false,
          error: errorMessage,
        },
      }
    }

    try {
      const wasSuccessful = await run<boolean>(
        (messageIdToMove: string, targetMailboxName: string, targetAccountName: string) => {
          const Mail = Application("Mail")

          let foundMessage: any = null
          let wasSuccess = false

          // Find the message across all accounts and mailboxes
          const allAccounts = Mail.accounts()
          for (const currentAccount of allAccounts) {
            if (foundMessage) break
            const allMailboxes = currentAccount.mailboxes()
            for (const mbox of allMailboxes) {
              if (foundMessage) break
              try {
                const msgs = mbox.messages.whose({ messageId: messageIdToMove })()
                if (msgs.length > 0) {
                  foundMessage = msgs[0]
                  break
                }
              } catch (e) {
                // ignore and continue searching
              }
            }
          }

          if (foundMessage) {
            try {
              // Get target mailbox reference
              const targetAccount = Mail.accounts.byName(targetAccountName)
              const targetMailboxRef = targetAccount.mailboxes.byName(targetMailboxName)

              // Move the message to the target mailbox
              Mail.move(foundMessage, { to: targetMailboxRef })
              wasSuccess = true
            } catch (e) {
              // Move operation failed
            }
          }

          return wasSuccess
        },
        moveRequest.messageId,
        moveRequest.targetMailboxName,
        moveRequest.targetAccountName,
      )

      const movedEmail: MovedEmailDetails = {
        messageId: moveRequest.messageId,
        success: wasSuccessful,
        error: wasSuccessful ? undefined : "Move operation failed",
      }

      return {
        success: wasSuccessful,
        message: wasSuccessful ? "Successfully moved message." : "Failed to move message.",
        movedEmail,
      }
    } catch (error) {
      const movedEmail: MovedEmailDetails = {
        messageId: moveRequest.messageId,
        success: false,
        error: `JXA execution failed: ${error instanceof Error ? error.message : String(error)}`,
      }

      return {
        success: false,
        message: `Error moving email: ${error instanceof Error ? error.message : String(error)}`,
        movedEmail,
      }
    }
  } catch (error) {
    console.error("Error in moveEmails:", error)
    const movedEmail: MovedEmailDetails = {
      messageId: moveRequest.messageId,
      success: false,
      error: `Error moving email: ${error instanceof Error ? error.message : String(error)}`,
    }

    return {
      success: false,
      message: `Error moving email: ${error instanceof Error ? error.message : String(error)}`,
      movedEmail,
    }
  }
}

interface CopyEmailRequest {
  messageId: string
  targetMailboxName: string
  targetAccountName: string
}

interface CopiedEmailDetails {
  messageId: string
  success: boolean
  error?: string
}

async function copyEmails(
  copyRequest: CopyEmailRequest,
): Promise<{ success: boolean; message: string; copiedEmail: CopiedEmailDetails }> {
  try {
    if (!(await checkMailAccess())) {
      return {
        success: false,
        message: "Mail app not accessible.",
        copiedEmail: {
          messageId: copyRequest.messageId,
          success: false,
          error: "Mail app not accessible.",
        },
      }
    }

    // Get all available mailboxes for validation
    const allMailboxes = await listMailboxes()
    const validMailboxes = new Set(allMailboxes.map((mb) => `${mb.account}/${mb.mailbox}`))

    // Validate target mailbox before attempting copy
    const targetKey = `${copyRequest.targetAccountName}/${copyRequest.targetMailboxName}`
    if (!validMailboxes.has(targetKey)) {
      const availableAccounts = [...new Set(allMailboxes.map((mb) => mb.account))]
      const availableMailboxesForAccount = allMailboxes
        .filter((mb) => mb.account === copyRequest.targetAccountName)
        .map((mb) => mb.mailbox)

      const errorMessage =
        availableMailboxesForAccount.length > 0
          ? `Mailbox "${copyRequest.targetMailboxName}" not found in account "${copyRequest.targetAccountName}". Available mailboxes: ${availableMailboxesForAccount.join(", ")}`
          : `Account "${copyRequest.targetAccountName}" not found. Available accounts: ${availableAccounts.join(", ")}`

      return {
        success: false,
        message: errorMessage,
        copiedEmail: {
          messageId: copyRequest.messageId,
          success: false,
          error: errorMessage,
        },
      }
    }

    try {
      const wasSuccessful = await run<boolean>(
        (messageIdToCopy: string, targetMailboxName: string, targetAccountName: string) => {
          const Mail = Application("Mail")

          let foundMessage: any = null
          let wasSuccess = false

          // Find the message across all accounts and mailboxes
          const allAccounts = Mail.accounts()
          for (const currentAccount of allAccounts) {
            if (foundMessage) break
            const allMailboxes = currentAccount.mailboxes()
            for (const mbox of allMailboxes) {
              if (foundMessage) break
              try {
                const msgs = mbox.messages.whose({ messageId: messageIdToCopy })()
                if (msgs.length > 0) {
                  foundMessage = msgs[0]
                  break
                }
              } catch (e) {
                // ignore and continue searching
              }
            }
          }

          if (foundMessage) {
            try {
              // Get target mailbox reference
              const targetAccount = Mail.accounts.byName(targetAccountName)
              const targetMailboxRef = targetAccount.mailboxes.byName(targetMailboxName)

              // Copy the message to the target mailbox
              Mail.duplicate(foundMessage, { to: targetMailboxRef })
              wasSuccess = true
            } catch (e) {
              // Copy operation failed
            }
          }

          return wasSuccess
        },
        copyRequest.messageId,
        copyRequest.targetMailboxName,
        copyRequest.targetAccountName,
      )

      const copiedEmail: CopiedEmailDetails = {
        messageId: copyRequest.messageId,
        success: wasSuccessful,
        error: wasSuccessful ? undefined : "Copy operation failed",
      }

      return {
        success: wasSuccessful,
        message: wasSuccessful ? "Successfully copied message." : "Failed to copy message.",
        copiedEmail,
      }
    } catch (error) {
      const copiedEmail: CopiedEmailDetails = {
        messageId: copyRequest.messageId,
        success: false,
        error: `JXA execution failed: ${error instanceof Error ? error.message : String(error)}`,
      }

      return {
        success: false,
        message: `Error copying email: ${error instanceof Error ? error.message : String(error)}`,
        copiedEmail,
      }
    }
  } catch (error) {
    console.error("Error in copyEmails:", error)
    const copiedEmail: CopiedEmailDetails = {
      messageId: copyRequest.messageId,
      success: false,
      error: `Error copying email: ${error instanceof Error ? error.message : String(error)}`,
    }

    return {
      success: false,
      message: `Error copying email: ${error instanceof Error ? error.message : String(error)}`,
      copiedEmail,
    }
  }
}

interface ArchiveEmailRequest {
  messageId: string
}

interface ArchivedEmailDetails {
  messageId: string
  success: boolean
  error?: string
}

async function archiveEmails(
  archiveRequest: ArchiveEmailRequest,
): Promise<{ success: boolean; message: string; archivedEmail: ArchivedEmailDetails }> {
  try {
    if (!(await checkMailAccess())) {
      return {
        success: false,
        message: "Mail app not accessible.",
        archivedEmail: {
          messageId: archiveRequest.messageId,
          success: false,
          error: "Mail app not accessible.",
        },
      }
    }

    try {
      const wasSuccessful = await run<boolean>((messageIdToArchive: string) => {
        const Mail = Application("Mail")
        // Mail.activate()

        let foundMessage: any = null
        let wasSuccess = false

        // Find the message across all accounts and mailboxes
        const allAccounts = Mail.accounts()
        for (const account of allAccounts) {
          if (!account.enabled()) continue
          const mailboxes = account.mailboxes()
          for (const mailbox of mailboxes) {
            try {
              const messages = mailbox.messages.whose({ messageId: messageIdToArchive })()
              if (messages.length > 0) {
                foundMessage = messages[0]
                break
              }
            } catch (e) {
              // ignore, continue search
            }
          }
          if (foundMessage) break
        }

        if (foundMessage) {
          try {
            // Attempt 1: Try standard archive function first
            Mail.archive(foundMessage)
            wasSuccess = true
          } catch (e1) {
            try {
              // Attempt 2: Two-step archive (move to Trash, then to Archive)
              const sourceAccount = foundMessage.mailbox().account()
              const trashMailbox = sourceAccount.mailboxes.byName("Trash")

              // Move to trash first
              Mail.move(foundMessage, { to: trashMailbox })

              // Find the message in trash and move to archive
              let messageInTrash: any = null
              try {
                const messagesInTrash = trashMailbox.messages.whose({
                  messageId: messageIdToArchive,
                })()
                if (messagesInTrash.length > 0) {
                  messageInTrash = messagesInTrash[0]
                }
              } catch (eFindInTrash) {
                // ignore
              }

              if (messageInTrash) {
                const archiveMailbox = sourceAccount.mailboxes.byName("Archive")
                Mail.move(messageInTrash, { to: archiveMailbox })
                wasSuccess = true
              }
            } catch (e2) {
              // Two-step archive also failed
            }
          }
        }

        return wasSuccess
      }, archiveRequest.messageId)

      const archivedEmail: ArchivedEmailDetails = {
        messageId: archiveRequest.messageId,
        success: wasSuccessful,
        error: wasSuccessful ? undefined : "Archiving failed",
      }

      return {
        success: wasSuccessful,
        message: wasSuccessful ? "Successfully archived message." : "Failed to archive message.",
        archivedEmail,
      }
    } catch (error) {
      const archivedEmail: ArchivedEmailDetails = {
        messageId: archiveRequest.messageId,
        success: false,
        error: `JXA execution failed: ${error instanceof Error ? error.message : String(error)}`,
      }

      return {
        success: false,
        message: `Error archiving email: ${error instanceof Error ? error.message : String(error)}`,
        archivedEmail,
      }
    }
  } catch (error) {
    console.error("Error in archiveEmails:", error)
    const archivedEmail: ArchivedEmailDetails = {
      messageId: archiveRequest.messageId,
      success: false,
      error: `Error archiving email: ${error instanceof Error ? error.message : String(error)}`,
    }

    return {
      success: false,
      message: `Error archiving email: ${error instanceof Error ? error.message : String(error)}`,
      archivedEmail,
    }
  }
}

interface TrashEmailRequest {
  messageId: string
}

interface TrashedEmailDetails {
  messageId: string
  success: boolean
  error?: string
}

async function trashEmails(
  trashRequest: TrashEmailRequest,
): Promise<{ success: boolean; message: string; trashedEmail: TrashedEmailDetails }> {
  try {
    if (!(await checkMailAccess())) {
      return {
        success: false,
        message: "Mail app not accessible.",
        trashedEmail: {
          messageId: trashRequest.messageId,
          success: false,
          error: "Mail app not accessible.",
        },
      }
    }

    try {
      const wasSuccessful = await run<boolean>((messageIdToTrash: string) => {
        const Mail = Application("Mail")

        let foundMessage: any = null
        let wasSuccess = false

        // Find the message across all accounts and mailboxes
        const allAccounts = Mail.accounts()
        for (const currentAccount of allAccounts) {
          if (foundMessage) break
          const allMailboxes = currentAccount.mailboxes()
          for (const mbox of allMailboxes) {
            if (foundMessage) break
            try {
              const msgs = mbox.messages.whose({ messageId: messageIdToTrash })()
              if (msgs.length > 0) {
                foundMessage = msgs[0]
                break
              }
            } catch (e) {
              // ignore and continue searching
            }
          }
        }

        if (foundMessage) {
          try {
            // Get the account of the found message
            const sourceAccount = foundMessage.mailbox().account()
            const trashMailbox = sourceAccount.mailboxes.byName("Trash")

            // Move the message to the trash mailbox
            Mail.move(foundMessage, { to: trashMailbox })
            wasSuccess = true
          } catch (e) {
            // Trash operation failed
          }
        }

        return wasSuccess
      }, trashRequest.messageId)

      const trashedEmail: TrashedEmailDetails = {
        messageId: trashRequest.messageId,
        success: wasSuccessful,
        error: wasSuccessful ? undefined : "Trash operation failed",
      }

      return {
        success: wasSuccessful,
        message: wasSuccessful
          ? "Successfully moved message to trash."
          : "Failed to move message to trash.",
        trashedEmail,
      }
    } catch (error) {
      const trashedEmail: TrashedEmailDetails = {
        messageId: trashRequest.messageId,
        success: false,
        error: `JXA execution failed: ${error instanceof Error ? error.message : String(error)}`,
      }

      return {
        success: false,
        message: `Error moving email to trash: ${error instanceof Error ? error.message : String(error)}`,
        trashedEmail,
      }
    }
  } catch (error) {
    console.error("Error in trashEmails:", error)
    const trashedEmail: TrashedEmailDetails = {
      messageId: trashRequest.messageId,
      success: false,
      error: `Error moving email to trash: ${error instanceof Error ? error.message : String(error)}`,
    }

    return {
      success: false,
      message: `Error moving email to trash: ${error instanceof Error ? error.message : String(error)}`,
      trashedEmail,
    }
  }
}

async function listMailboxes(): Promise<MailboxEntry[]> {
  try {
    if (!(await checkMailAccess())) {
      return []
    }

    return run<MailboxEntry[]>(() => {
      const Mail = Application("Mail")
      const mailboxes: MailboxEntry[] = []

      // Get mailboxes from all accounts
      const allAccounts = Mail.accounts()
      for (const acct of allAccounts) {
        const acctName = acct.name()
        const acctMailboxes = acct.mailboxes()
        for (const mbox of acctMailboxes) {
          mailboxes.push({ account: acctName, mailbox: mbox.name() })
        }
      }

      // Get "On My Mac" mailboxes
      try {
        const localMailboxes = Mail.localMailboxes()
        for (const mbox of localMailboxes) {
          mailboxes.push({ account: "On My Mac", mailbox: mbox.name() })
        }
      } catch (e) {
        // If localMailboxes() doesn't exist or fails, silently continue
        // Some versions of Mail might not have this property
      }

      // Deduplicate mailboxes by account and mailbox combination
      const seenMailboxKeys = new Set<string>()
      const uniqueMailboxes = mailboxes.filter((mb) => {
        const key = `${mb.account}/${mb.mailbox}`
        if (seenMailboxKeys.has(key)) {
          return false
        }
        seenMailboxKeys.add(key)
        return true
      })

      return uniqueMailboxes
    })
  } catch (error) {
    console.error("Error in listMailboxes:", error)
    throw new Error(
      `Error listing mailboxes: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export default {
  createDraftEmail,
  listEmails,
  readEmails,
  moveEmails,
  copyEmails,
  archiveEmails,
  trashEmails,
  listMailboxes,
  checkMailAccess,
}
