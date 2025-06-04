import Fuse from "fuse.js"
import { run } from "@jxa/run"

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
                const msgs = mbox.messages.whose({ id: originalMessageIdArg })()
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
          theDraft.content = bodyTextArg + "\r\n\r\n" + theDraft.content()
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
            return { success: false, message: `Attachment error: ${errMsg.message || String(errMsg)}` }
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
  limit = 100,
  accountName: targetAccountName,
  mailboxName: targetMailboxName,
  isRead: filterIsRead,
  isFlagged: filterIsFlagged,
}: ListEmailsParams): Promise<EmailMessage[]> {
  try {
    if (!(await checkMailAccess())) {
      return []
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
                emailRecord.messageId = msg.id()
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
      const allMailboxesRaw = await listMailboxes()
      const matchingInboxName = allMailboxesRaw
        .filter((mb) => mb.account === targetAccountName && mb.mailbox.toLowerCase() === "inbox")
        .pop()?.mailbox

      if (!matchingInboxName) {
        throw new Error(`No inbox found in account '${targetAccountName}'`)
      }
      mailboxesToFetch.push({ account: targetAccountName, mailbox: matchingInboxName })
    } else {
      const allMailboxesRaw = await listMailboxes()
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

    allEmails.sort((a, b) => {
      const dateA = a.dateReceived ? new Date(a.dateReceived).getTime() : 0
      const dateB = b.dateReceived ? new Date(b.dateReceived).getTime() : 0
      return dateB - dateA
    })

    if (searchTerm && searchTerm.trim() !== "") {
      const fuse = new Fuse(allEmails, {
        keys: ["subject", "sender"],
        includeScore: true,
        threshold: 0.4,
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

    return allEmails.slice(0, limit)
  } catch (error) {
    console.error("Error in listEmails:", error)
    throw new Error(
      `Error listing emails: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function readEmail(messageId: string): Promise<EmailMessage | null> {
  try {
    if (!(await checkMailAccess())) {
      return null
    }

    return run<EmailMessage | null>((msgId: string) => {
      const Mail = Application("Mail")
      if (!Mail.running()) Mail.activate()
      delay(1)

      const allAccounts = Mail.accounts()
      for (const currentAccount of allAccounts) {
        if (!currentAccount.enabled()) continue

        const allMailboxes = currentAccount.mailboxes()
        for (const currentMailbox of allMailboxes) {
          try {
            const msgs = currentMailbox.messages.whose({ id: msgId })()
            if (msgs.length > 0) {
              const msg = msgs[0]
              const dateReceived = msg.dateReceived()
              return {
                account: currentAccount.name(),
                mailbox: currentMailbox.name(),
                messageId: msg.id(),
                subject: msg.subject() || "[No Subject]",
                sender: msg.sender() || "[Unknown Sender]",
                dateReceived: dateReceived ? dateReceived.toISOString() : undefined,
                isRead: msg.readStatus(),
                isFlagged: msg.flaggedStatus(),
                content: msg.content(),
              }
            }
          } catch (e) {
            // ignore and continue
          }
        }
      }
      return null
    }, messageId)
  } catch (error) {
    console.error("Error in readEmail:", error)
    throw new Error(
      `Error reading email: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function moveEmail(
  messageId: string,
  targetMailboxName: string,
  targetAccountName?: string,
): Promise<{ success: boolean; message: string }> {
  try {
    if (!(await checkMailAccess())) {
      return { success: false, message: "Mail app not accessible." }
    }

    return run<{ success: boolean; message: string }>(
      (msgId: string, tgtMailboxName: string, tgtAccountName?: string) => {
        const Mail = Application("Mail")
        Mail.activate()
        let foundMessageRef: any = null

        const allAccounts = Mail.accounts()
        for (const currentAccount of allAccounts) {
          if (foundMessageRef) break
          const allMailboxes = currentAccount.mailboxes()
          for (const mbox of allMailboxes) {
            if (foundMessageRef) break
            try {
              const msgs = mbox.messages.whose({ id: msgId })()
              if (msgs.length > 0) {
                foundMessageRef = msgs[0]
                break
              }
            } catch (e) {
              /* ignore */
            }
          }
        }

        if (!foundMessageRef) {
          return { success: false, message: `Could not find message with ID: ${msgId}` }
        }

        let targetMailboxRef: any = null
        try {
          if (tgtAccountName) {
            const acc = Mail.accounts.byName(tgtAccountName)
            if (acc.exists()) {
              targetMailboxRef = acc.mailboxes.byName(tgtMailboxName)
            }
          } else {
            targetMailboxRef = Mail.mailboxes.byName(tgtMailboxName)
            if (!targetMailboxRef.exists()) {
              for (const account of Mail.accounts()) {
                const mb = account.mailboxes.byName(tgtMailboxName)
                if (mb.exists()) {
                  targetMailboxRef = mb
                  break
                }
              }
            }
          }
          if (!targetMailboxRef || !targetMailboxRef.exists()) {
            return {
              success: false,
              message: `Target mailbox "${tgtMailboxName}" ${tgtAccountName ? `in account "${tgtAccountName}"` : ""} not found.`,
            }
          }
        } catch (e: any) {
          return { success: false, message: `Error finding target mailbox: ${e.message || String(e)}` }
        }

        try {
          Mail.move(foundMessageRef, { to: targetMailboxRef })
          return {
            success: true,
            message: `Message ${msgId} moved to ${tgtMailboxName} successfully.`,
          }
        } catch (e: any) {
          return { success: false, message: `Error moving message: ${e.message || String(e)}` }
        }
      },
      messageId,
      targetMailboxName,
      targetAccountName,
    )
  } catch (error) {
    console.error("Error in moveEmail:", error)
    return {
      success: false,
      message: `Error moving email: ${error instanceof Error ? error.message : String(error)}`,
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

      const allAccounts = Mail.accounts()
      for (const acct of allAccounts) {
        const acctName = acct.name()
        const acctMailboxes = acct.mailboxes()
        for (const mbox of acctMailboxes) {
          mailboxes.push({ account: acctName, mailbox: mbox.name() })
        }
      }
      return mailboxes
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
  readEmail,
  moveEmail,
  listMailboxes,
  checkMailAccess,
}
