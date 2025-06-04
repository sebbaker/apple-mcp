import Fuse from "fuse.js"
import { runAppleScript } from "run-applescript"

async function checkMailAccess(): Promise<boolean> {
  try {
    // First check if Mail is running
    const isRunning = await runAppleScript(`
tell application "System Events"
    return application process "Mail" exists
end tell`)

    if (isRunning !== "true") {
      console.error("Mail app is not running, attempting to launch...")
      try {
        await runAppleScript(`
tell application "Mail" to activate
delay 2`)
      } catch (activateError) {
        console.error("Error activating Mail app:", activateError)
        throw new Error("Could not activate Mail app. Please start it manually.")
      }
    }

    //     // Try to get the count of mailboxes as a simple test
    //     try {
    //       await runAppleScript(`
    // tell application "Mail"
    //     count every mailbox
    // end tell`)
    //       return true
    //     } catch (mailboxError) {
    //       console.error("Error accessing mailboxes:", mailboxError)

    //       // Try an alternative check
    //       try {
    //         const mailVersion = await runAppleScript(`
    // tell application "Mail"
    //     return its version
    // end tell`)
    //         console.error("Mail version:", mailVersion)
    //         return true
    //       } catch (versionError) {
    //         console.error("Error getting Mail version:", versionError)
    //         throw new Error(
    //           "Mail app is running but cannot access mailboxes. Please check permissions and configuration.",
    //         )
    //       }
    //     }
    return true
  } catch (error) {
    console.error("Mail access check failed:", error)
    throw new Error(
      `Cannot access Mail app. Please make sure Mail is running and properly configured. Error: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

interface EmailMessage {
  account?: string;
  mailbox?: string;
  messageId: string;
  subject: string;
  sender: string;
  dateReceived?: string; // Keep as string from AppleScript, will parse to Date later
  isRead?: boolean;
  isFlagged?: boolean;
  content?: string; // For readEmail
}

interface ListEmailsParams {
  searchTerm?: string;
  limit?: number;
  accountName?: string;
  mailboxName?: string;
  isRead?: boolean;
  isFlagged?: boolean;
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
on createDraftEmail(isReply, originalMessageId, toAddress, subjectText, bodyText, attachmentPath)
    tell application "Mail"
        activate
        set theDraft to missing value
        if isReply is true then
            if originalMessageId is "" or originalMessageId is missing value then
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
                        set msgs to messages of mbox whose id is originalMessageId
                        if (count of msgs) > 0 then
                            set foundMessage to item 1 of msgs
                            exit repeat
                        end if
                    end try
                end repeat
            end repeat
            
            if foundMessage is missing value then
                return {success:false, message:"Could not find original message with ID: " & originalMessageId}
            end if
            set theDraft to reply foundMessage with opening window
            set content of theDraft to bodyText & return & return & content of theDraft
        else
            set theDraft to make new outgoing message with properties {visible:true, subject:subjectText, content:bodyText}
            if toAddress is not "" and toAddress is not missing value then
                make new to recipient at theDraft with properties {address:toAddress}
            end if
        end if
        
        if attachmentPath is not "" and attachmentPath is not missing value then
            try
                set attachmentFile to POSIX file attachmentPath
                make new attachment at theDraft with properties {file name:attachmentFile}
            on error errMsg
                return {success:false, message:"Attachment error: " & errMsg}
            end try
        end if
        
        delay 0.5 -- Give Mail a moment to save
        return {success:true, message:"Draft created successfully.", draftId:id of theDraft}
    end tell
end createDraftEmail

return createDraftEmail(${isReply}, "${originalMessageId || ""}", "${toAddress || ""}", "${subjectText.replace(/"/g, '\\"')}", "${bodyText.replace(/"/g, '\\"')}", "${attachmentPath || ""}")
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
  limit = 25,
  accountName: targetAccountName,
  mailboxName: targetMailboxName,
  isRead: filterIsRead,
  isFlagged: filterIsFlagged,
}: ListEmailsParams): Promise<EmailMessage[]> {
  try {
    if (!(await checkMailAccess())) {
      return [];
    }

    const getEmailsFromMailbox = async (
      account: string,
      mailbox: string,
    ): Promise<EmailMessage[]> => {
      // This script is based on the user's apple-scripts/list-emails.applescript
      // but modified to output JSON for robust parsing and to set the message limit.
      const script = `
on listEmailsInMailbox(targetAccountNameStr, targetMailboxNameStr)
    set emailJsonList to {}
    tell application "Mail"
        try
            set theAccount to account targetAccountNameStr
            if not (exists theAccount) then error "Account '" & targetAccountNameStr & "' not found."
            if not (enabled of theAccount) then error "Account '" & targetAccountNameStr & "' is not enabled."

            set theMailbox to mailbox targetMailboxNameStr of theAccount
            if not (exists theMailbox) then error "Mailbox '" & targetMailboxNameStr & "' not found in account '" & targetAccountNameStr & "'."
            
            set allMessageReferencesInMailbox to messages of theMailbox
            set messageCount to count of allMessageReferencesInMailbox
            set messagesToProcess to {}
            
            if messageCount > 0 then
                if messageCount > 200 then -- User specified limit for AppleScript part
                    set messagesToProcess to (messages 1 thru 200 of theMailbox)
                else
                    set messagesToProcess to allMessageReferencesInMailbox
                end if
            else
                return "[]" -- Return empty JSON array string
            end if
            
            repeat with msg in messagesToProcess
                try
                    set msgId to id of msg
                    set msgSubject to subject of msg
                    set msgSender to sender of msg
                    set msgDateReceived to (date received of msg) as string
                    set msgIsRead to read status of msg
                    set msgIsFlagged to flagged status of msg
                    
                    -- Escape characters for JSON string
                    set msgSubject to escapeJsonString(msgSubject)
                    set msgSender to escapeJsonString(msgSender)
                    set msgDateReceived to escapeJsonString(msgDateReceived)
                    
                    set emailJson to "{ \\"account\\": \\"" & targetAccountNameStr & "\\", " & ¬
                                      "\\"mailbox\\": \\"" & targetMailboxNameStr & "\\", " & ¬
                                      "\\"messageId\\": \\"" & msgId & "\\", " & ¬
                                      "\\"subject\\": \\"" & msgSubject & "\\", " & ¬
                                      "\\"sender\\": \\"" & msgSender & "\\", " & ¬
                                      "\\"dateReceived\\": \\"" & msgDateReceived & "\\", " & ¬
                                      "\\"isRead\\": " & msgIsRead & ", " & ¬
                                      "\\"isFlagged\\": " & msgIsFlagged & " }"
                    set end of emailJsonList to emailJson
                on error errMsgInner
                    -- log "Error processing a message: " & errMsgInner
                end try
            end repeat
        on error errMsg
            -- log "Error in listEmailsInMailbox: " & errMsg
            return "[]" -- Return empty JSON array string on error
        end try
    end tell
    
    set AppleScript's text item delimiters to ","
    set jsonArrayString to "[" & (emailJsonList as string) & "]"
    set AppleScript's text item delimiters to "" -- Reset delimiters
    return jsonArrayString
end listEmailsInMailbox

on escapeJsonString(inputString)
    if inputString is missing value then return ""
    set tempString to inputString
    set AppleScript's text item delimiters to "\\\\"
    set tempString to text items of tempString
    set AppleScript's text item delimiters to "\\\\\\\\" -- escape backslash
    set tempString to tempString as string
    
    set AppleScript's text item delimiters to "\\""
    set tempString to text items of tempString
    set AppleScript's text item delimiters to "\\\\\\"" -- escape double quote
    set tempString to tempString as string
    
    set AppleScript's text item delimiters to "/"
    set tempString to text items of tempString
    set AppleScript's text item delimiters to "\\\\/" -- escape slash
    set tempString to tempString as string
    
    set AppleScript's text item delimiters to "\\b"
    set tempString to text items of tempString
    set AppleScript's text item delimiters to "\\\\b"
    set tempString to tempString as string
    
    set AppleScript's text item delimiters to "\\f"
    set tempString to text items of tempString
    set AppleScript's text item delimiters to "\\\\f"
    set tempString to tempString as string
    
    set AppleScript's text item delimiters to "\\n"
    set tempString to text items of tempString
    set AppleScript's text item delimiters to "\\\\n"
    set tempString to tempString as string
    
    set AppleScript's text item delimiters to "\\r"
    set tempString to text items of tempString
    set AppleScript's text item delimiters to "\\\\r"
    set tempString to tempString as string
    
    set AppleScript's text item delimiters to "\\t"
    set tempString to text items of tempString
    set AppleScript's text item delimiters to "\\\\t"
    set tempString to tempString as string
    
    set AppleScript's text item delimiters to "" -- Reset
    return tempString
end escapeJsonString

return listEmailsInMailbox("${account.replace(/"/g, '\\"')}", "${mailbox.replace(/"/g, '\\"')}")
`;
      try {
        const rawResult = await runAppleScript(script);
        if (rawResult && rawResult.trim().startsWith("[")) {
          return JSON.parse(rawResult) as EmailMessage[];
        }
        console.error(`Failed to parse JSON from AppleScript for ${account}/${mailbox}: ${rawResult}`);
        return [];
      } catch (e) {
        console.error(`Error running/parsing AppleScript for ${account}/${mailbox}:`, e);
        return [];
      }
    };

    let mailboxesToFetch: { account: string; mailbox: string }[] = [];

    if (targetAccountName && targetMailboxName) {
      mailboxesToFetch.push({ account: targetAccountName, mailbox: targetMailboxName });
    } else if (targetAccountName && !targetMailboxName) {
      mailboxesToFetch.push({ account: targetAccountName, mailbox: "Inbox" });
    } else { // No specific account, or only mailbox specified
      const allMailboxesRaw = await listMailboxes(); // Get all "account/mailbox" strings
      const allAccountsAndMailboxes = allMailboxesRaw.map(mbStr => {
        const parts = mbStr.split('/');
        return { account: parts[0], mailbox: parts.slice(1).join('/') }; // Handle mailboxes with '/' in their name
      });

      if (targetMailboxName) { // Only mailbox specified, search in all accounts
        allAccountsAndMailboxes.forEach(accMbox => {
          if (accMbox.mailbox.toLowerCase() === targetMailboxName.toLowerCase()) {
            mailboxesToFetch.push(accMbox);
          }
        });
      } else { // Neither account nor mailbox specified, default to Inbox in all accounts
        allAccountsAndMailboxes.forEach(accMbox => {
          if (accMbox.mailbox.toLowerCase() === "inbox") {
            mailboxesToFetch.push(accMbox);
          }
        });
      }
    }
    
    // Remove duplicate mailboxes to fetch (e.g. if user specifies "Inbox" and we also default to it)
    mailboxesToFetch = mailboxesToFetch.filter((mb, index, self) =>
        index === self.findIndex((t) => (
            t.account === mb.account && t.mailbox === mb.mailbox
        ))
    );

    if (mailboxesToFetch.length === 0) {
        console.error("No mailboxes identified to fetch emails from.");
        return [];
    }

    const emailPromises = mailboxesToFetch.map(mb => getEmailsFromMailbox(mb.account, mb.mailbox));
    const resultsByMailbox = await Promise.all(emailPromises);
    let allEmails = resultsByMailbox.flat();

    // Sort by dateReceived (descending)
    allEmails.sort((a, b) => {
      const dateA = a.dateReceived ? new Date(a.dateReceived).getTime() : 0;
      const dateB = b.dateReceived ? new Date(b.dateReceived).getTime() : 0;
      return dateB - dateA;
    });

    // Apply TypeScript-side filtering
    if (searchTerm && searchTerm.trim() !== "") {
      const fuse = new Fuse(allEmails, {
        keys: ["subject", "sender"], // User specified subject and sender
        includeScore: true,
        threshold: 0.4,
        isCaseSensitive: false,
      });
      allEmails = fuse.search(searchTerm).map((result) => result.item);
    }

    if (typeof filterIsRead === 'boolean') {
      allEmails = allEmails.filter(email => email.isRead === filterIsRead);
    }

    if (typeof filterIsFlagged === 'boolean') {
      allEmails = allEmails.filter(email => email.isFlagged === filterIsFlagged);
    }

    return allEmails.slice(0, limit);
  } catch (error) {
    console.error("Error in listEmails:", error);
    throw new Error(
      `Error listing emails: ${error instanceof Error ? error.message : String(error)}`,
    );
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
on readEmailById(targetID)
    set foundEmail to missing value
    tell application "Mail"
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
                        set msgs to messages of currentMailbox whose id is targetID
                        if (count of msgs) > 0 then
                            set msg to item 1 of msgs
                            set foundEmail to {¬
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
    end tell
    if foundEmail is missing value then
        return "Error: No email found with ID " & targetID
    else
        return foundEmail
    end if
end readEmailById

return readEmailById("${messageId}")
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
      targetMailboxScript = `set targetMailbox to mailbox "${targetMailboxName.replace(/"/g, '\\"')}" of account "${targetAccountName.replace(/"/g, '\\"')}"`
    }

    const script = `
on moveMessage(msgId, tgtMailboxName, tgtAccountName)
    tell application "Mail"
        activate
        set foundMessage to missing value
        
        -- Find the message
        set allAccounts to every account
        repeat with currentAccount in allAccounts
            if foundMessage is not missing value then exit repeat
            set allMailboxes to every mailbox of currentAccount
            repeat with mbox in allMailboxes
                if foundMessage is not missing value then exit repeat
                try
                    set msgs to messages of mbox whose id is msgId
                    if (count of msgs) > 0 then
                        set foundMessage to item 1 of msgs
                        exit repeat
                    end if
                end try
            end repeat
        end repeat

        if foundMessage is missing value then
            return {success:false, message:"Could not find message with ID: " & msgId}
        end if

        -- Find the target mailbox
        try
            ${targetMailboxScript}
            if not (exists targetMailbox) then
                 error "Target mailbox " & tgtMailboxName & " not found."
            end if
        on error errMsg
            return {success:false, message:"Error finding target mailbox: " & errMsg}
        end try
        
        try
            move foundMessage to targetMailbox
            return {success:true, message:"Message " & msgId & " moved to " & tgtMailboxName & " successfully."}
        on error errMsg
            return {success:false, message:"Error moving message: " & errMsg}
        end try
    end tell
end moveMessage

return moveMessage("${messageId}", "${targetMailboxName.replace(/"/g, '\\"')}", ${targetAccountName ? `"${targetAccountName.replace(/"/g, '\\"')}"` : "missing value"})
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

interface MailboxInfo {
  account: string;
  mailbox: string;
  totalCount?: number;
  unreadCount?: number;
}

async function listMailboxes(accountName?: string): Promise<string[]> {
  try {
    if (!(await checkMailAccess())) {
      return [];
    }

    // The new apple-scripts/list-mailboxes.applescript returns JSON directly.
    // We need to construct the script to call that script's logic.
    // For simplicity, we'll embed the core logic here, adapted to optionally filter by account
    // and ensure it returns the "account/mailbox" string format.

    let script = `
set mailboxList to {}
tell application "Mail"
    if not (running) then activate
    delay 1
    
    set accountsToProcess to {}
    if "${accountName ? accountName.replace(/"/g, '\\"') : ""}" is not "" then
        try
            set targetAccount to account "${accountName!.replace(/"/g, '\\"')}"
            if exists targetAccount then
                set accountsToProcess to {targetAccount}
            else
                return "Error: Account '" & "${accountName!.replace(/"/g, '\\"')}" & "' not found."
            end if
        on error
             return "Error: Account '" & "${accountName!.replace(/"/g, '\\"')}" & "' not found."
        end try
    else
        set accountsToProcess to every account
    end if
    
    repeat with currentAccount in accountsToProcess
        try
            if enabled of currentAccount then
                set accName to name of currentAccount
                set accountMailboxes to mailboxes of currentAccount
                repeat with mb in accountMailboxes
                    set end of mailboxList to (accName & "/" & (name of mb as string))
                end repeat
            end if
        end try
    end repeat
    
    -- If no specific account, also consider "On My Mac" top-level mailboxes if they exist
    -- However, the user's script for list-mailboxes.applescript handles "On My Mac" separately.
    -- For consistency with the previous listMailboxes, we'll stick to account-based iteration.
    -- If "On My Mac" is desired when no accountName is specified, it should be handled by calling
    -- this function with accountName "On My Mac" or by enhancing the script.
    -- The provided apple-scripts/list-mailboxes.applescript seems to handle "On My Mac" when no account is specified.
    -- Let's use the user's provided script logic for list-mailboxes.applescript if no accountName is given.
    
    if "${accountName ? "" : "true"}" is "true" then -- Simulating the logic from user's list-mailboxes.applescript for "all"
        set localMailboxes to mailboxes whose container is not an account -- This gets top-level mailboxes like "On My Mac"
        repeat with mbox in localMailboxes
            set mboxName to name of mbox
            -- Check if it's already added via an account (e.g. iCloud/Inbox vs On My Mac/Inbox)
            -- For simplicity, we'll just add them. Duplicates can be filtered in TS if necessary.
            set end of mailboxList to ("On My Mac" & "/" & mboxName)
        end repeat
    end if
    
end tell
return mailboxList
`;
    // If a specific accountName is provided, the script above handles it.
    // If no accountName, we want to mimic the behavior of the user's new apple-scripts/list-mailboxes.applescript
    // which returns JSON. The current listMailboxes in TS is expected to return string[].
    // Let's adjust to use the JSON output from the user's script if no accountName is given.

    if (!accountName) {
        // Use the logic from the user's new apple-scripts/list-mailboxes.applescript
        // This script is expected to return a JSON string representing MailboxInfo[]
        script = `
set mailboxData to {}
tell application "Mail"
    set allAccounts to every account
    repeat with acct in allAccounts
        set acctName to name of acct
        set acctMailboxes to every mailbox of acct
        repeat with mbox in acctMailboxes
            set mboxName to name of mbox
            set end of mailboxData to (acctName & "/" & mboxName)
        end repeat
    end repeat
    
    -- Handle "On My Mac" top-level mailboxes (mailboxes not directly under an account)
    try
        set localMailboxesContainer to mailboxes whose container is not an account
        repeat with mbox in localMailboxesContainer
            set mboxName to name of mbox
            set end of mailboxData to ("On My Mac" & "/" & mboxName)
        end repeat
    on error
        -- "On My Mac" might not exist or have mailboxes
    end try
end tell
set AppleScript's text item delimiters to ","
set outputString to mailboxData as string 
set AppleScript's text item delimiters to "" -- Reset to default
return outputString
`;
    }


    const rawResult = await runAppleScript(script);

    if (rawResult.startsWith("Error:")) {
      console.error(`Error from AppleScript (listMailboxes): ${rawResult}`);
      throw new Error(rawResult);
    }
    
    if (rawResult.trim() === "") {
        return [];
    }

    const mailboxes = rawResult.split(",").map(mb => mb.trim()).filter(mb => mb.length > 0);
    // Remove duplicates that might arise from "On My Mac" logic
    return [...new Set(mailboxes)];

  } catch (error) {
    console.error("Error in listMailboxes:", error);
    throw new Error(
      `Error listing mailboxes: ${error instanceof Error ? error.message : String(error)}`,
    );
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
