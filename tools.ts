import { type Tool } from "@modelcontextprotocol/sdk/types.js"

const MAIL_TOOL: Tool = {
  name: "mail",
  description:
    "Interact with Apple Mail app - create drafts, list emails, read emails, move emails, and list mailboxes.",
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "Operation to perform: 'createDraft', 'list', 'read', 'move', 'listMailboxes'",
        enum: ["createDraft", "list", "read", "move", "listMailboxes"],
      },
      // For createDraft
      isReply: {
        type: "boolean",
        description:
          "Set to true if creating a reply to an existing email (for createDraft operation).",
      },
      originalMessageId: {
        // Used by createDraft (if isReply)
        type: "string",
        description:
          "The ID of the original message if isReply is true (for createDraft operation).",
      },
      toAddress: {
        type: "string",
        description: "Recipient's email address (for createDraft operation, if not a reply).",
      },
      subject: {
        type: "string",
        description: "Subject of the email (for createDraft operation).",
      },
      body: {
        type: "string",
        description: "Body content of the email (for createDraft operation).",
      },
      attachmentPath: {
        type: "string",
        description: "Absolute path to a file to attach (optional, for createDraft operation).",
      },
      // For list
      searchTerm: {
        type: "string",
        description:
          "Text to search for in email subject and sender (optional, for list operation).",
      },
      limit: {
        type: "number",
        description: "Number of emails to retrieve (optional, for list operation, default 25).",
      },
      accountName: {
        // New for list
        type: "string",
        description: "The name of the account to list emails from (optional for list operation).",
      },
      mailboxName: {
        // New for list
        type: "string",
        description:
          "The name of the mailbox to list emails from (optional for list operation, defaults to 'Inbox').",
      },
      isRead: {
        // New for list
        type: "boolean",
        description: "Filter emails by read status (optional for list operation).",
      },
      isFlagged: {
        // New for list
        type: "boolean",
        description: "Filter emails by flagged status (optional for list operation).",
      },
      // For read & move
      messageId: {
        type: "string",
        description: "The ID of the email to read or move (required for read and move operations).",
      },
      // For move
      targetMailboxName: {
        type: "string",
        description: "The name of the mailbox to move the email to (required for move operation).",
      },
      targetAccountName: {
        type: "string",
        description:
          "The name of the account for the target mailbox (optional for move operation, recommended if mailbox name is not unique).",
      },
    },
    required: ["operation"],
  },
}

const tools = [MAIL_TOOL]

export default tools
