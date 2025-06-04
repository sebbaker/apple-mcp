import Fuse from "fuse.js"
import { runAppleScript } from "run-applescript"

async function checkMailAccess(): Promise<boolean> {
  try {
    // First check if Mail is running
    const isRunning = await runAppleScript(
      `
tell application "System Events"
    return application process "Mail" exists
end tell`,
    )

    if (isRunning !== "true") {
      console.error("Mail app is not running, attempting to launch...")
      try {
        await runAppleScript(
          `
tell application "Mail" to activate
delay 2`,
        )
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
  dateReceived?: string // Keep as string from AppleScript, will parse to Date later
  isRead?: boolean
  isFlagged?: boolean
  content?: string // For readEmail
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

    const script = `
tell application "Mail"
    activate
    set theDraft to missing value
    if ${isReply} is true then
        if "${originalMessageId || ""}" is "" or "${originalMessageId || ""}" is missing value then
            return {success:false, message:"Original message ID is required for a reply."}
        end if
        set foundMessage to missing value
        set allAccounts to every account
        repeat with currentAccount in allAccounts
            if foundMessage is not missing value then exit repeat
            set allMailboxes to every mailbox of currentAccount
            repeat with mbox in allMailboxes
                if foundMessage is not missing value then exit repeat
                try
                    set msgs to messages of mbox whose id is "${originalMessageId || ""}"
                    if (count of msgs) > 0 then
                        set foundMessage to item 1 of msgs
                        exit repeat
                    end if
                end try
            end repeat
        end repeat
        
        if foundMessage is missing value then
            return {success:false, message:"Could not find original message with ID: " & "${originalMessageId || ""}"}
        end if
        set theDraft to reply foundMessage with opening window
        set content of theDraft to "${bodyText.replace(/"/g, '\\"')}" & return & return & content of theDraft
    else
        set theDraft to make new outgoing message with properties {visible:true, subject:"${subjectText.replace(/"/g, '\\"')}", content:"${bodyText.replace(/"/g, '\\"')}"}
        if "${toAddress || ""}" is not "" and "${toAddress || ""}" is not missing value then
            make new to recipient at theDraft with properties {address:"${toAddress || ""}"}
        end if
    end if
    
    if "${attachmentPath || ""}" is not "" and "${attachmentPath || ""}" is not missing value then
        try
            set attachmentFile to POSIX file "${attachmentPath || ""}"
            make new attachment at theDraft with properties {file name:attachmentFile}
        on error errMsg
            return {success:false, message:"Attachment error: " & errMsg}
        end try
    end if
    
    delay 0.5 -- Give Mail a moment to save
    return {success:true, message:"Draft created successfully.", draftId:id of theDraft}
end tell
`
    const resultString = await runAppleScript(script)
    // AppleScript might return a string representation of a record
    // We need to parse this carefully or rely on specific success/error messages.
    // For simplicity, let's assume the script returns a string that we can parse or check.
    // A more robust solution would be to have AppleScript return JSON.
    if (resultString.includes("success:true")) {
      let draftId
      const idMatch = resultString.match(/draftId:"([^"]+)"/)
      if (idMatch && idMatch[1]) {
        draftId = idMatch[1]
      }
      return { success: true, message: "Draft created successfully.", draftId }
    } else if (resultString.includes("success:false")) {
      const messageMatch = resultString.match(/message:"([^"]+)"/)
      const message = messageMatch ? messageMatch[1] : "Failed to create draft."
      return { success: false, message }
    }
    // Fallback for unexpected AppleScript output
    return { success: false, message: `Unexpected result from AppleScript: ${resultString}` }
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

    const getEmailsFromMailbox = async (
      account: string, // TypeScript variable for account name
      mailbox: string, // TypeScript variable for mailbox name
    ): Promise<EmailMessage[]> => {
      const script = `
-- Get Recent Emails from a Specific Mailbox (Function Version)
-- This script defines a function to retrieve up to 200 of the most recent emails
-- from a user-specified mailbox in a user-specified mail account.

-- Define the main handler (function)
tell application "Mail"
  set targetAccountName to "${account}"
  set targetMailboxName to "${mailbox}"
	
	set specificEmails to {}
	
	-- Check if Mail application is running or can be accessed
	if not (exists) then
		log "Mail application not found or not running."
		return specificEmails
	end if
	
	try
		-- Attempt to get the specified account by its name
		set theAccount to account targetAccountName
		if not (exists theAccount) then
			log "Account named '" & targetAccountName & "' not found."
			-- Optionally, display a dialog to the user:
			-- display dialog "Error: Account '" & targetAccountName & "' not found." buttons {"OK"} default button "OK"
			return specificEmails
		end if
		
		-- Check if the account is enabled
		if not (enabled of theAccount) then
			log "Account '" & targetAccountName & "' is not enabled."
			-- Optionally, display a dialog:
			-- display dialog "Error: Account '" & targetAccountName & "' is disabled." buttons {"OK"} default button "OK"
			return specificEmails
		end if
		
		try
			-- Attempt to get the specified mailbox within the account
			set theMailbox to mailbox targetMailboxName of theAccount
			if not (exists theMailbox) then
				log "Mailbox named '" & targetMailboxName & "' not found in account '" & targetAccountName & "'."
				-- Optionally, display a dialog:
				-- display dialog "Error: Mailbox '" & targetMailboxName & "' not found in account '" & targetAccountName & "'." buttons {"OK"} default button "OK"
				return specificEmails
			end if
			
			-- Get references to messages in the mailbox
			set allMessageReferencesInMailbox to a reference to messages of theMailbox
			set messageCount to count of allMessageReferencesInMailbox
			set messagesToProcess to {}
			
			if messageCount > 0 then
				if messageCount > 200 then
					-- Get the 200 most recent messages
					set messagesToProcess to (messages 1 thru 200 of theMailbox)
					log "Found " & messageCount & " messages in '" & targetMailboxName & "' of account '" & targetAccountName & "'. Processing the most recent 200."
				else
					-- Get all messages if there are 200 or fewer
					set messagesToProcess to messages of theMailbox
					log "Found " & messageCount & " messages in '" & targetMailboxName & "' of account '" & targetAccountName & "'. Processing all of them."
				end if
			else
				log "No messages found in mailbox '" & targetMailboxName & "' of account '" & targetAccountName & "'."
				return specificEmails
			end if
			
			-- Loop through the selected messages and extract details
			repeat with msg in messagesToProcess
				try
					set emailRecord to {account:targetAccountName, mailbox:targetMailboxName}
					
					try
						set emailRecord to emailRecord & {messageId:id of msg}
					on error
						set emailRecord to emailRecord & {messageId:"[No ID]"}
					end try
					
					try
						set emailRecord to emailRecord & {subject:subject of msg}
					on error
						set emailRecord to emailRecord & {subject:"[No Subject]"}
					end try
					
					try
						set emailRecord to emailRecord & {sender:sender of msg}
					on error
						set emailRecord to emailRecord & {sender:"[Unknown Sender]"}
					end try
					
					try
						set emailRecord to emailRecord & {dateReceived:date received of msg}
					on error
						set emailRecord to emailRecord & {dateReceived:missing value}
					end try
					
					try
						set emailRecord to emailRecord & {isRead:read status of msg}
					on error
						set emailRecord to emailRecord & {isRead:missing value}
					end try
					
					try
						set emailRecord to emailRecord & {isFlagged:flagged status of msg}
					on error
						set emailRecord to emailRecord & {isFlagged:missing value}
					end try
					
					set end of specificEmails to emailRecord
				on error errMsgInner number errNumInner
					log "Error processing a message: " & errMsgInner & " (Number: " & errNumInner & ")"
					-- Continue to the next message
				end try
			end repeat
			
		on error errMsgMailbox number errNumMailbox
			log "Error accessing mailbox '" & targetMailboxName & "' in account '" & targetAccountName & "': " & errMsgMailbox & " (Number: " & errNumMailbox & ")"
			return specificEmails
		end try
		
	on error errMsgAccount number errNumAccount
		log "Error accessing account '" & targetAccountName & "': " & errMsgAccount & " (Number: " & errNumAccount & ")"
		return specificEmails
	end try
	
	return specificEmails
end tell
`

      try {
        const result: unknown = await runAppleScript(script);

        if (Array.isArray(result)) {
          // Check if all items in the array are objects (or if the array is empty)
          if (result.length === 0 || result.every(item => typeof item === 'object' && item !== null)) {
            return result as EmailMessage[];
          } else {
            // Array contains non-object items, which is unexpected
            console.error(
              `AppleScript for ${account}/${mailbox} returned array with non-object items:`,
              result,
            );
            return []; // Treat as no emails found
          }
        } else if (result === null || result === undefined) {
          // Handles cases where run-applescript might return null/undefined
          return [];
        } else if (typeof result === 'string') {
          if (result.trim() === '') { // Empty string result
            return [];
          }
          // Non-empty string, likely an error message or unexpected script output
          console.error(
            `AppleScript for ${account}/${mailbox} returned unexpected string: ${result}`,
          );
          return []; // Treat as no emails found
        } else {
          // Any other type is unexpected
          console.error(
            `AppleScript for ${account}/${mailbox} returned unexpected type ${typeof result}:`,
            result,
          );
          return []; // Treat as no emails found
        }
      } catch (e) {
        // This catches errors during runAppleScript execution (e.g., osascript errors)
        console.error(`Error running AppleScript for ${account}/${mailbox}:`, e);
        return []; // Treat as no emails found
      }
    }

    let mailboxesToFetch: { account: string; mailbox: string }[] = []

    if (targetAccountName && targetMailboxName) {
      mailboxesToFetch.push({ account: targetAccountName, mailbox: targetMailboxName })
    } else if (targetAccountName && !targetMailboxName) {
      const matchingInboxName = (await listMailboxes())
        .filter((mb) => mb.account === targetAccountName && mb.mailbox.toLowerCase() === "inbox")
        .pop()?.mailbox

      if (!matchingInboxName) {
        throw new Error("No inbox found in account")
      }

      mailboxesToFetch.push({ account: targetAccountName, mailbox: matchingInboxName })
    } else {
      // No specific account, or only mailbox specified
      const allMailboxesRaw = await listMailboxes() // Get all "account/mailbox" strings

      if (targetMailboxName) {
        // Only mailbox specified, search in all accounts
        allMailboxesRaw.forEach((accMbox) => {
          if (accMbox.mailbox.toLowerCase() === targetMailboxName.toLowerCase()) {
            mailboxesToFetch.push(accMbox)
          }
        })
      } else {
        // Neither account nor mailbox specified, default to Inbox in all accounts
        allMailboxesRaw.forEach((accMbox) => {
          if (accMbox.mailbox.toLowerCase() === "inbox") {
            mailboxesToFetch.push(accMbox)
          }
        })
      }
    }

    // Remove duplicate mailboxes to fetch (e.g. if user specifies "Inbox" and we also default to it)
    mailboxesToFetch = mailboxesToFetch.filter(
      (mb, index, self) =>
        index === self.findIndex((t) => t.account === mb.account && t.mailbox === mb.mailbox),
    )

    if (mailboxesToFetch.length === 0) {
      throw new Error("No mailboxes identified to fetch emails from.")
    }

    const emailPromises = mailboxesToFetch.map((mb) => getEmailsFromMailbox(mb.account, mb.mailbox))
    const resultsByMailbox = await Promise.all(emailPromises)
    let allEmails = resultsByMailbox.flat()

    // Sort by dateReceived (descending)
    allEmails.sort((a, b) => {
      const dateA = a.dateReceived ? new Date(a.dateReceived).getTime() : 0
      const dateB = b.dateReceived ? new Date(b.dateReceived).getTime() : 0
      return dateB - dateA
    })

    // Apply TypeScript-side filtering
    if (searchTerm && searchTerm.trim() !== "") {
      const fuse = new Fuse(allEmails, {
        keys: ["subject", "sender"], // User specified subject and sender
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
    // The AppleScript needs the targetID to be set.
    // We will pass it as an argument to the script.
    const script = `
tell application "Mail"
    set foundEmail to missing value
    if not (running) then activate
    delay 1
    set allAccounts to every account
    repeat with currentAccount in allAccounts
        if foundEmail is not missing value then exit repeat
        if enabled of currentAccount then
            set allMailboxes to every mailbox of currentAccount
            repeat with currentMailbox in allMailboxes
                if foundEmail is not missing value then exit repeat
                try
                    set msgs to messages of currentMailbox whose id is "${messageId}"
                    if (count of msgs) > 0 then
                        set msg to item 1 of msgs
                        set foundEmail to {
                            account:name of currentAccount, ¬
                            mailbox:name of currentMailbox, ¬
                            messageId:id of msg, ¬
                            subject:subject of msg, ¬
                            sender:sender of msg, ¬
                            dateReceived:(date received of msg) as string, ¬
                            isRead:read status of msg, ¬
                            isFlagged:flagged status of msg, ¬
                            content:content of msg}
                        exit repeat
                    end if
                end try
            end repeat
        end if
    end repeat
    if foundEmail is missing value then
        return "Error: No email found with ID " & "${messageId}"
    else
        return foundEmail
    end if
end tell
`

    const rawResult = await runAppleScript(script)

    if (rawResult.startsWith("Error:")) {
      console.error(`Error from AppleScript (readEmail): ${rawResult}`)
      return null
    }

    // Similar brittle parsing as listEmails.
    const recordRegex =
      /\{account:"([^"]*)", mailbox:"([^"]*)", messageId:"([^"]*)", subject:"([^"]*)", sender:"([^"]*)", dateReceived:"([^"]*)", isRead:(true|false), isFlagged:(true|false), content:"((?:[^"]|\\")*)"\}/
    const match = recordRegex.exec(rawResult)

    if (match) {
      return {
        account: match[1],
        mailbox: match[2],
        messageId: match[3],
        subject: match[4],
        sender: match[5],
        dateReceived: match[6],
        isRead: match[7] === "true",
        isFlagged: match[8] === "true",
        content: match[9].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\r/g, "\r"), // Unescape content
      }
    }
    console.error(`Failed to parse email details from AppleScript result: ${rawResult}`)
    return null
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

    // Construct the target mailbox part of the script carefully
    let targetMailboxScript = `set targetMailbox to mailbox "${targetMailboxName.replace(/"/g, '\\"')}"`
    if (targetAccountName) {
      targetMailboxScript = `set targetMailbox to mailbox "${targetMailboxName.replace(/"/g, '\\"')}" of account "${targetAccountName.replace(/"/g, '\\"')}`
    }

    const script = `
tell application "Mail"
    activate
    set foundMessage to missing value
    set msgId_apple to "${messageId}"
    set tgtMailboxName_apple to "${targetMailboxName.replace(/"/g, '\\"')}"
    set tgtAccountName_apple to ${targetAccountName ? `"${targetAccountName.replace(/"/g, '\\"')}"` : "missing value"}

    -- Find the message
    set allAccounts to every account
    repeat with currentAccount in allAccounts
        if foundMessage is not missing value then exit repeat
        set allMailboxes to every mailbox of currentAccount
        repeat with mbox in allMailboxes
            if foundMessage is not missing value then exit repeat
            try
                set msgs to messages of mbox whose id is msgId_apple
                if (count of msgs) > 0 then
                    set msg to item 1 of msgs
                    set foundMessage to {¬
                        account:name of currentAccount, ¬
                        mailbox:name of currentMailbox, ¬
                        messageId:id of msg, ¬
                        subject:subject of msg, ¬
                        sender:sender of msg, ¬
                        dateReceived:(date received of msg) as string, ¬
                        isRead:read status of msg, ¬
                        isFlagged:flagged status of msg, ¬
                        content:content of msg}
                    exit repeat
                end if
            end try
        end repeat
    end repeat

    if foundMessage is missing value then
        return {success:false, message:"Could not find message with ID: " & msgId_apple}
    end if

    -- Find the target mailbox
    try
        if tgtAccountName_apple is missing value then
            set targetMailbox to mailbox tgtMailboxName_apple
        else
            set targetMailbox to mailbox tgtMailboxName_apple of account tgtAccountName_apple
        end if
        
        if not (exists targetMailbox) then
             error "Target mailbox " & tgtMailboxName_apple & " not found."
        end if
    on error errMsg
        return {success:false, message:"Error finding target mailbox: " & errMsg}
    end try
    
    try
        move foundMessage to targetMailbox
        return {success:true, message:"Message " & msgId_apple & " moved to " & tgtMailboxName_apple & " successfully."}
    on error errMsg
        return {success:false, message:"Error moving message: " & errMsg}
    end try
end tell
`

    const resultString = await runAppleScript(script)
    if (resultString.includes("success:true")) {
      const messageMatch = resultString.match(/message:"([^"]+)"/)
      const message = messageMatch ? messageMatch[1] : "Message moved successfully."
      return { success: true, message }
    } else {
      const messageMatch = resultString.match(/message:"([^"]+)"/)
      const message = messageMatch ? messageMatch[1] : "Failed to move message."
      return { success: false, message }
    }
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

    const script = `
tell application "Mail"
	set jsonOutputString to "["
	set isFirstEntry to true
	
	set allAccounts to every account
	repeat with acct in allAccounts
		set acctName to name of acct
		set acctMailboxes to every mailbox of acct
		
		repeat with mbox in acctMailboxes
			set mboxName to name of mbox
			set isInbox to mboxName contains "Inbox"
			
			set jsonEntry to "{\\"account\\": \\"" & acctName & "\\", " & "\\"mailbox\\": \\"" & mboxName & "\\""
			
			if isInbox then
				try
					set messageCount to count of messages of mbox
					set unreadMessages to (every message of mbox whose read status is false)
					set unreadCount to count of unreadMessages
					set jsonEntry to jsonEntry & ", \\"totalCount\\": " & messageCount & ", \\"unreadCount\\": " & unreadCount
				on error
					set jsonEntry to jsonEntry & ", \\"totalCount\\": -1, \\"unreadCount\\": -1"
				end try
			end if
			
			set jsonEntry to jsonEntry & "}"
			
			if isFirstEntry is true then
				set jsonOutputString to jsonOutputString & jsonEntry
				set isFirstEntry to false
			else
				set jsonOutputString to jsonOutputString & "," & jsonEntry
			end if
		end repeat
	end repeat
	
	set localMailboxes to mailboxes of application "Mail"
	repeat with mbox in localMailboxes
		set mboxName to name of mbox
		set isInbox to mboxName contains "Inbox"
		
		set jsonEntry to "{\\"account\\": \\"On My Mac\\", " & "\\"mailbox\\": \\"" & mboxName & "\\""
		
		if isInbox then
			try
				set messageCount to count of messages of mbox
				set unreadMessages to (every message of mbox whose read status is false)
				set unreadCount to count of unreadMessages
				set jsonEntry to jsonEntry & ", \\"totalCount\\": " & messageCount & ", \\"unreadCount\\": " & unreadCount
			on error
				set jsonEntry to jsonEntry & ", \\"totalCount\\": -1, \\"unreadCount\\": -1"
			end try
		end if
		
		set jsonEntry to jsonEntry & "}"
		
		if isFirstEntry is true then
			set jsonOutputString to jsonOutputString & jsonEntry
			set isFirstEntry to false
		else
			set jsonOutputString to jsonOutputString & "," & jsonEntry
		end if
	end repeat
	
	set jsonOutputString to jsonOutputString & "]"
	return jsonOutputString
end tell
`

    const rawResult = await runAppleScript(script)

    if (rawResult.startsWith("Error:")) {
      console.error(`Error from AppleScript (listMailboxes): ${rawResult}`)
      throw new Error(rawResult)
    }

    if (!rawResult || rawResult.trim() === "" || rawResult.trim() === "[]") {
      return []
    }

    return JSON.parse(rawResult) as MailboxEntry[]
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
