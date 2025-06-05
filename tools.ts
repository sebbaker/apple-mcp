import { type Tool } from "@modelcontextprotocol/sdk/types.js"

const CREATE_DRAFT_TOOL: Tool = {
  name: "createDraft",
  description: "Create draft emails in Apple Mail app.",
  inputSchema: {
    type: "object",
    properties: {
      isReply: {
        type: "boolean",
        description: "Set to true if creating a reply to an existing email.",
      },
      originalMessageId: {
        type: "string",
        description: "The ID of the original message if isReply is true.",
      },
      toAddress: {
        type: "string",
        description: "Recipient's email address (if not a reply).",
      },
      subject: {
        type: "string",
        description: "Subject of the email.",
      },
      body: {
        type: "string",
        description: "Body content of the email.",
      },
      attachmentPath: {
        type: "string",
        description: "Absolute path to a file to attach (optional).",
      },
    },
    required: ["isReply", "subject", "body"],
  },
}

const LIST_EMAILS_TOOL: Tool = {
  name: "listEmails",
  description:
    "List emails from Apple Mail app with filtering options. ALWAYS use listMailboxes first to get valid account and mailbox names.",
  inputSchema: {
    type: "object",
    properties: {
      searchTerm: {
        type: "string",
        description: "Text to search for in email subject and sender (optional).",
      },
      limit: {
        type: "number",
        description: "Number of emails to retrieve (optional, default 25).",
      },
      accountName: {
        type: "string",
        description: "The name of the account to list emails from (optional).",
      },
      mailboxName: {
        type: "string",
        description: "The name of the mailbox to list emails from (optional, defaults to 'Inbox').",
      },
      isRead: {
        type: "boolean",
        description: "Filter emails by read status (optional).",
      },
      isFlagged: {
        type: "boolean",
        description: "Filter emails by flagged status (optional).",
      },
    },
    required: [],
  },
}

const READ_EMAILS_TOOL: Tool = {
  name: "readEmails",
  description: "Read the full content, source, and extracted links of specific emails by their IDs. Optionally, provide account and mailbox for faster lookup.",
  inputSchema: {
    type: "object",
    properties: {
      readRequests: {
        type: "array",
        items: {
          type: "object",
          properties: {
            messageId: { type: "string", description: "The ID of the message to read." },
            account: { type: "string", description: "Optional: The account name where the email is located for faster lookup." },
            mailbox: { type: "string", description: "Optional: The mailbox name where the email is located for faster lookup." },
          },
          required: ["messageId"],
        },
        description: "Array of read requests, each specifying a messageId and optionally account and mailbox.",
      },
    },
    required: ["readRequests"],
  },
}

const LIST_MAILBOXES_TOOL: Tool = {
  name: "listMailboxes",
  description: "List all available mailboxes across all accounts in Apple Mail app.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
}

const MOVE_TOOL: Tool = {
  name: "move",
  description:
    "Move a single email in Apple Mail app. ALWAYS use listMailboxes first to get valid account and mailbox names.",
  inputSchema: {
    type: "object",
    properties: {
      messageId: {
        type: "string",
        description: "The message ID of the email to move.",
      },
      targetMailboxName: {
        type: "string",
        description: "The name of the target mailbox.",
      },
      targetAccountName: {
        type: "string",
        description: "The name of the target account.",
      },
    },
    required: ["messageId", "targetMailboxName", "targetAccountName"],
  },
}

const ARCHIVE_TOOL: Tool = {
  name: "archive",
  description: "Archive a single email. Works for different account types.",
  inputSchema: {
    type: "object",
    properties: {
      messageId: {
        type: "string",
        description: "The message ID of the email to archive.",
      },
    },
    required: ["messageId"],
  },
}

const COPY_TOOL: Tool = {
  name: "copy",
  description:
    "Copy a single email to a specified mailbox while keeping the original in its current location. ALWAYS use listMailboxes first to get valid account and mailbox names.",
  inputSchema: {
    type: "object",
    properties: {
      messageId: {
        type: "string",
        description: "The message ID of the email to copy.",
      },
      targetMailboxName: {
        type: "string",
        description: "The name of the target mailbox.",
      },
      targetAccountName: {
        type: "string",
        description: "The name of the target account.",
      },
    },
    required: ["messageId", "targetMailboxName", "targetAccountName"],
  },
}

const TRASH_TOOL: Tool = {
  name: "trash",
  description: "Move a single email to trash mailbox.",
  inputSchema: {
    type: "object",
    properties: {
      messageId: {
        type: "string",
        description: "The message ID of the email to move to trash.",
      },
    },
    required: ["messageId"],
  },
}

const tools = [
  CREATE_DRAFT_TOOL,
  LIST_EMAILS_TOOL,
  READ_EMAILS_TOOL,
  LIST_MAILBOXES_TOOL,
  MOVE_TOOL,
  ARCHIVE_TOOL,
  COPY_TOOL,
  TRASH_TOOL,
]

export default tools
