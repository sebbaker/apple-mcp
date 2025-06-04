-- Move an email to a target mailbox by its message ID
-- Supports moving to local or account-based mailboxes

on moveEmailById(messageIdToMove, targetMailboxName, targetAccountName)
	tell application "Mail"
		activate
		
		-- Search for the message
		set foundMessage to missing value
		set allAccounts to every account
		
		repeat with acct in allAccounts
			set mailboxesList to every mailbox of acct
			repeat with mbox in mailboxesList
				try
					set msgs to messages of mbox
					repeat with msg in msgs
						if id of msg is messageIdToMove then
							set foundMessage to msg
							exit repeat
						end if
					end repeat
				end try
				if foundMessage is not missing value then exit repeat
			end repeat
			if foundMessage is not missing value then exit repeat
		end repeat
		
		if foundMessage is missing value then
			display dialog "Message ID not found: " & messageIdToMove buttons {"OK"} default button "OK"
			return
		end if
		
		-- Find the destination mailbox
		set destinationMailbox to missing value
		repeat with acct in allAccounts
			if name of acct is equal to targetAccountName then
				set acctMailboxes to every mailbox of acct
				repeat with mbox in acctMailboxes
					if name of mbox is equal to targetMailboxName then
						set destinationMailbox to mbox
						exit repeat
					end if
				end repeat
			end if
			if destinationMailbox is not missing value then exit repeat
		end repeat
		
		-- Try On My Mac if not found in account
		if destinationMailbox is missing value then
			set localMailboxes to mailboxes of mail
			repeat with mbox in localMailboxes
				if name of mbox is equal to targetMailboxName then
					set destinationMailbox to mbox
					exit repeat
				end if
			end repeat
		end if
		
		if destinationMailbox is missing value then
			display dialog "Target mailbox not found: " & targetMailboxName buttons {"OK"} default button "OK"
			return
		end if
		
		-- Move the message
		move foundMessage to destinationMailbox
		display dialog "Message moved to " & name of destinationMailbox buttons {"OK"} default button "OK"
	end tell
end moveEmailById

-- 🟢 Example Usage:
-- Replace with your actual values below:
moveEmailById("81506", "Saved", "iCloud") -- or "On My Mac" if local