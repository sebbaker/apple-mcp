set mailboxData to {}

tell application "Mail"
	set allAccounts to every account
	
	repeat with acct in allAccounts
		set acctName to name of acct
		set acctMailboxes to every mailbox of acct
		
		repeat with mbox in acctMailboxes
			set mboxName to name of mbox
			set isInbox to mboxName contains "Inbox"
			
			set jsonEntry to "{\"account\": \"" & acctName & "\", " & ¬
				"\"mailbox\": \"" & mboxName & "\""
			
			if isInbox then
				try
					set messageCount to count of messages of mbox
					set unreadMessages to (every message of mbox whose read status is false)
					set unreadCount to count of unreadMessages
					set jsonEntry to jsonEntry & ", \"totalCount\": " & messageCount & ", \"unreadCount\": " & unreadCount
				on error
					set jsonEntry to jsonEntry & ", \"totalCount\": -1, \"unreadCount\": -1"
				end try
			end if
			
			set jsonEntry to jsonEntry & "}"
			set end of mailboxData to jsonEntry
		end repeat
	end repeat
	
	-- Handle "On My Mac" top-level mailboxes
	set localMailboxes to mailboxes of application "Mail"
	repeat with mbox in localMailboxes
		set mboxName to name of mbox
		set isInbox to mboxName contains "Inbox"
		
		set jsonEntry to "{\"account\": \"On My Mac\", " & ¬
			"\"mailbox\": \"" & mboxName & "\""
		
		if isInbox then
			try
				set messageCount to count of messages of mbox
				set unreadMessages to (every message of mbox whose read status is false)
				set unreadCount to count of unreadMessages
				set jsonEntry to jsonEntry & ", \"totalCount\": " & messageCount & ", \"unreadCount\": " & unreadCount
			on error
				set jsonEntry to jsonEntry & ", \"totalCount\": -1, \"unreadCount\": -1"
			end try
		end if
		
		set jsonEntry to jsonEntry & "}"
		set end of mailboxData to jsonEntry
	end repeat
end tell

-- Output final JSON array
set AppleScript's text item delimiters to ", "
set jsonOutput to "[" & (mailboxData as string) & "]"
return jsonOutput