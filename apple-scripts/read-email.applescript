on run
	set targetID to missing value -- Replace with your Mail message ID
	set foundEmail to missing value
	
	tell application "Mail"
		set allAccounts to every account
		
		repeat with currentAccount in allAccounts
			if enabled of currentAccount then
				set allMailboxes to every mailbox of currentAccount
				
				repeat with currentMailbox in allMailboxes
					set boxName to name of currentMailbox
					
					if boxName contains "inbox" or boxName contains "Inbox" then
						set allMsgs to messages of currentMailbox
						
						repeat with msg in allMsgs
							if id of msg is equal to targetID then
								set foundEmail to {
									account:name of currentAccount, 
									mailbox:boxName, 
									id:id of msg, 
									subject:subject of msg, 
									sender:sender of msg, 
									dateReceived:date received of msg, 
									isRead:read status of msg, 
									isFlagged:flagged status of msg, 
									content:content of msg}
								exit repeat
							end if
						end repeat
						
						if foundEmail is not missing value then exit repeat
					end if
				end repeat
				
				if foundEmail is not missing value then exit repeat
			end if
		end repeat
	end tell
	
	if foundEmail is missing value then
		display dialog "No email found with ID " & targetID buttons {"OK"} default button "OK"
	else
		return foundEmail
	end if
end run