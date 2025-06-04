on createDraftEmail(isReply, originalMessageId, toAddress, subjectText, bodyText, attachmentPath)

	tell application "Mail"
		-- Ensure Mail is running
		activate
		
		set theDraft to missing value
		
		if isReply is true then
			-- Attempt to find original message by message ID
			set foundMessage to missing value
			set allMailboxes to every mailbox of every account
			
			repeat with accountMailboxes in allMailboxes
				repeat with mbox in accountMailboxes
					try
						set msgs to messages of mbox
						repeat with msg in msgs
							try
								if id of msg is originalMessageId then
									set foundMessage to msg
									exit repeat
								end if
							end try
						end repeat
						if foundMessage is not missing value then exit repeat
					end try
				end repeat
				if foundMessage is not missing value then exit repeat
			end repeat
			
			if foundMessage is missing value then
				display dialog "Could not find message with ID: " & originalMessageId buttons {"OK"} default button "OK"
				return
			end if
			
			-- Create reply and customize it
			set theDraft to reply foundMessage with opening window
			set content of theDraft to bodyText & return & return & content of theDraft
			
		else
			-- Create a new draft message
			set theDraft to make new outgoing message with properties {visible:true, subject:subjectText, content:bodyText}
			
			-- Add recipient if provided
			if toAddress is not "" then
				make new to recipient at theDraft with properties {address:toAddress}
			end if
		end if
		
		-- Add attachment if path provided
		if attachmentPath is not "" then
			set attachmentFile to POSIX file attachmentPath
			try
				make new attachment at theDraft with properties {file name:attachmentFile}
			on error errMsg
				display dialog "Attachment error: " & errMsg buttons {"OK"} default button "OK"
			end try
		end if
		
		-- Optional: wait to ensure it gets saved
		delay 2
	end tell
end createDraftEmail

-- 🟩 Example Usage 1: New Draft
-- createDraftEmail(false, "", "person@example.com", "Hello from AppleScript", "This is a saved draft message.", "/Users/yourusername/Desktop/sample.pdf")

-- 🟩 Example Usage 2: Reply Draft
-- Replace "YOUR_MESSAGE_ID_HERE" with a valid Mail message id (as returned by AppleScript)
-- createDraftEmail(true, "YOUR_MESSAGE_ID_HERE", "", "", "This is a reply draft.", "")