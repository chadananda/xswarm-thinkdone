// Connections catalog — productivity integrations organized by category.
// Pure data module. No side effects, no browser/server dependencies.

export const CONNECTION_CATEGORIES = [
  { id: 'google', label: 'Google', icon: '\u2726' },
  { id: 'microsoft', label: 'Microsoft', icon: '\u2B21' },
  { id: 'communication', label: 'Communication', icon: '\uD83D\uDCAC' },
  { id: 'project-management', label: 'Project Management', icon: '\uD83D\uDCCB' },
  { id: 'notes', label: 'Notes & Knowledge', icon: '\uD83D\uDCDD' },
  { id: 'automation', label: 'Automation', icon: '\u26A1' },
  { id: 'calendar', label: 'Calendar', icon: '\uD83D\uDCC5' },
];

export const CONNECTIONS = [
  // Google
  { id: 'google-calendar', name: 'Google Calendar', icon: '\uD83D\uDCC5', category: 'google', description: 'Sync events, see today\'s schedule in meetings', available: false, authType: 'oauth' },
  { id: 'google-tasks', name: 'Google Tasks', icon: '\u2611', category: 'google', description: 'Import and sync task lists', available: false, authType: 'oauth' },
  { id: 'gmail', name: 'Gmail', icon: '\u2709', category: 'google', description: 'Surface action items from email', available: false, authType: 'oauth' },
  { id: 'google-drive', name: 'Google Drive', icon: '\uD83D\uDCC1', category: 'google', description: 'Reference docs and files in meetings', available: false, authType: 'oauth' },

  // Microsoft
  { id: 'outlook-calendar', name: 'Outlook Calendar', icon: '\uD83D\uDCC5', category: 'microsoft', description: 'Sync events from Outlook', available: false, authType: 'oauth' },
  { id: 'microsoft-todo', name: 'Microsoft To Do', icon: '\u2611', category: 'microsoft', description: 'Sync tasks with Microsoft To Do', available: false, authType: 'oauth' },
  { id: 'onedrive', name: 'OneDrive', icon: '\u2601', category: 'microsoft', description: 'Access files from OneDrive', available: false, authType: 'oauth' },

  // Communication
  { id: 'slack', name: 'Slack', icon: '\u0023', category: 'communication', description: 'Surface messages and action items', available: false, authType: 'oauth' },
  { id: 'discord', name: 'Discord', icon: '\uD83C\uDFAE', category: 'communication', description: 'Monitor channels for updates', available: false, authType: 'discord' },

  // Project Management
  { id: 'asana', name: 'Asana', icon: '\u25CB', category: 'project-management', description: 'Sync projects and tasks', available: false, authType: 'oauth' },
  { id: 'clickup', name: 'ClickUp', icon: '\u2714', category: 'project-management', description: 'Sync spaces, lists, and tasks', available: false, authType: 'api_key' },
  { id: 'github-issues', name: 'GitHub Issues', icon: '\u25CF', category: 'project-management', description: 'Track issues and pull requests', available: false, authType: 'oauth' },
  { id: 'jira', name: 'Jira', icon: '\u25C6', category: 'project-management', description: 'Sync sprints and issues', available: false, authType: 'oauth' },
  { id: 'linear', name: 'Linear', icon: '\u25E8', category: 'project-management', description: 'Sync issues and cycles', available: false, authType: 'oauth' },
  { id: 'notion', name: 'Notion', icon: '\u25A0', category: 'project-management', description: 'Access pages, databases, and wikis', available: false, authType: 'oauth' },
  { id: 'todoist', name: 'Todoist', icon: '\u2713', category: 'project-management', description: 'Import and sync task lists', available: false, authType: 'oauth' },
  { id: 'trello', name: 'Trello', icon: '\u25A3', category: 'project-management', description: 'Sync boards and cards', available: false, authType: 'oauth' },

  // Notes & Knowledge
  { id: 'apple-notes', name: 'Apple Notes', icon: '\uD83D\uDCDD', category: 'notes', description: 'Access notes via iCloud', available: false, authType: 'oauth' },
  { id: 'evernote', name: 'Evernote', icon: '\uD83D\uDCD3', category: 'notes', description: 'Search and reference notebooks', available: false, authType: 'oauth' },
  { id: 'obsidian', name: 'Obsidian', icon: '\uD83D\uDC8E', category: 'notes', description: 'Access vault via local sync', available: false, authType: 'local' },

  // Automation
  { id: 'ifttt', name: 'IFTTT', icon: '\u229A', category: 'automation', description: 'Trigger applets from meetings', available: false, authType: 'api_key' },
  { id: 'make', name: 'Make', icon: '\u2699', category: 'automation', description: 'Run scenarios from meeting outcomes', available: false, authType: 'api_key' },
  { id: 'zapier', name: 'Zapier', icon: '\u26A1', category: 'automation', description: 'Trigger zaps from meeting outcomes', available: false, authType: 'api_key' },

  // Calendar
  { id: 'apple-calendar', name: 'Apple Calendar', icon: '\uD83D\uDCC5', category: 'calendar', description: 'Sync events via iCloud', available: false, authType: 'oauth' },
  { id: 'caldav', name: 'CalDAV', icon: '\uD83D\uDD17', category: 'calendar', description: 'Connect any CalDAV server', available: false, authType: 'api_key' },
];

export const CONNECTION_MAP = Object.fromEntries(
  CONNECTIONS.map(c => [c.id, c])
);

// Returns connections grouped by category, alphabetized within each group.
// Only includes categories that have at least one connection.
export function getConnectionsByCategory() {
  const groups = [];
  for (const cat of CONNECTION_CATEGORIES) {
    const items = CONNECTIONS
      .filter(c => c.category === cat.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (items.length > 0) {
      groups.push({ ...cat, connections: items });
    }
  }
  return groups;
}
