-- Get Recent Emails from a Specific Mailbox (Function Version)
-- This script defines a function to retrieve up to 1000 of the most recent emails
-- from a user-specified mailbox in a user-specified mail account.

-- Define the main handler (function)
on listEmails(targetAccountName as string, targetMailboxName as string)
	set specificEmails to {}
	
	tell application "Mail"
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
					if messageCount > 100 then
						-- Get the 1000 most recent messages
						set messagesToProcess to (messages 1 thru 100 of theMailbox)
						log "Found " & messageCount & " messages in '" & targetMailboxName & "' of account '" & targetAccountName & "'. Processing the most recent 100."
					else
						-- Get all messages if there are 100 or fewer
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
	end tell
	
	log "Function listEmails finished. Returning " & (count of specificEmails) & " emails."
	return specificEmails
end listEmails

