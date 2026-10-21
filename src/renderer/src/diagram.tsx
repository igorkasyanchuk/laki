// Diagram blocks for specs, ported from specdrop's web/diagram.tsx as it is: the editor (React Flow),
// the inline view, read mode, wireframes' catalog, PNG export. Its styles are plans.css (specdrop's tokens as --sd-*).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, Handle, Position, NodeResizer, BaseEdge,
  EdgeLabelRenderer, ConnectionMode, MarkerType, SelectionMode, addEdge, getSmoothStepPath, useNodesState, useEdgesState,
  useReactFlow, getNodesBounds, getViewportForBounds, ViewportPortal,
} from '@xyflow/react'
import type { Node, Edge, NodeProps, EdgeProps, Connection, XYPosition, NodeChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { toBlob } from 'html-to-image'
import type { Diagram, DiagramEdge } from './specmd'

export type { Diagram }

// ---------- wireframes: UI components from a catalog, laid out by drag and drop (like Balsamiq) ----------
// label: the component's own text (caption, field label, title); sub: its lines, one per line (links, list items, table rows
// with | between cells, tab names), a leading * marks the current / picked one; accent: primary, checked, on, warning.
// frame: sits behind whatever is dropped on it
type Wire = { title: string; group: string; size: [number, number]; label: string; sub?: string; hint?: string; lines?: string; frame?: boolean }
export const WIRES: Record<string, Wire> = {
  window: { title: 'Browser window', group: 'Frames', size: [640, 420], label: 'myapp.com', hint: 'Address', frame: true },
  mobile: { title: 'Mobile screen', group: 'Frames', size: [260, 480], label: 'Screen title', frame: true },
  dialog: { title: 'Dialog', group: 'Frames', size: [360, 190], label: 'Dialog title', sub: 'Are you sure you want to do this?', lines: 'Message', frame: true },
  card: { title: 'Card', group: 'Frames', size: [240, 150], label: 'Card title', sub: 'A short description of what this card holds.', lines: 'Text', frame: true },
  box: { title: 'Box', group: 'Frames', size: [200, 120], label: '', hint: 'Caption (optional)', frame: true },
  tablet: { title: 'Tablet screen', group: 'Frames', size: [440, 580], label: 'Screen title', frame: true },
  appwindow: { title: 'Desktop app window', group: 'Frames', size: [560, 380], label: 'My app', hint: 'Window title', frame: true },
  panel: { title: 'Panel', group: 'Frames', size: [260, 180], label: 'Panel title', hint: 'Title', frame: true },
  drawer: { title: 'Drawer / side sheet', group: 'Frames', size: [280, 420], label: 'Filters', hint: 'Title', frame: true },
  navbar: { title: 'Header / nav bar', group: 'Navigation', size: [640, 52], label: 'Logo', sub: '*Home\nPricing\nDocs\n[Sign in]', hint: 'Logo / app name',
    lines: 'Links, one per line: * the current page, [Text] a button' },
  sidebar: { title: 'Sidebar menu', group: 'Navigation', size: [180, 300], label: 'My app', sub: '*Dashboard\nProjects\nTeam\nSettings', hint: 'Title',
    lines: 'Items, one per line: * the current one' },
  tabs: { title: 'Tabs', group: 'Navigation', size: [360, 36], label: '', sub: '*Overview\nActivity\nSettings', hint: 'Caption (optional)', lines: 'Tabs, one per line: * the open one' },
  breadcrumbs: { title: 'Breadcrumbs', group: 'Navigation', size: [280, 24], label: 'Home / Projects / Alpha', hint: 'Path, parts split by /' },
  pagination: { title: 'Pagination', group: 'Navigation', size: [230, 32], label: '‹ 1 *2 3 … 9 ›', hint: 'Pages split by spaces: * the current one' },
  footer: { title: 'Footer', group: 'Navigation', size: [640, 56], label: '© 2026 My app', sub: 'Privacy\nTerms\nContact', lines: 'Links, one per line' },
  stepper: { title: 'Steps / wizard', group: 'Navigation', size: [420, 36], label: '', sub: 'Account\n*Plan\nPayment\nDone', hint: 'Caption (optional)',
    lines: 'Steps, one per line: * the current one' },
  link: { title: 'Link', group: 'Navigation', size: [120, 20], label: 'Learn more →', hint: 'Text' },
  button: { title: 'Button', group: 'Inputs', size: [120, 36], label: 'Button', hint: 'Caption (Accent: primary)' },
  iconbutton: { title: 'Icon button', group: 'Inputs', size: [36, 36], label: '☰', hint: 'Icon, e.g. ☰ ⋯ ✕ + ⚙ ♡ (Accent: primary)' },
  input: { title: 'Text field', group: 'Inputs', size: [240, 58], label: 'Email', sub: 'you@example.com', hint: 'Field label', lines: 'Placeholder or value' },
  textarea: { title: 'Text area', group: 'Inputs', size: [240, 110], label: 'Message', sub: 'Write something…', hint: 'Field label', lines: 'Placeholder or value' },
  select: { title: 'Dropdown', group: 'Inputs', size: [200, 58], label: 'Country', sub: 'Choose…', hint: 'Field label', lines: 'Selected value' },
  checkbox: { title: 'Checkbox', group: 'Inputs', size: [180, 22], label: 'Remember me', hint: 'Caption (Accent: checked)' },
  radio: { title: 'Radio group', group: 'Inputs', size: [180, 52], label: '', sub: '*Monthly\nYearly', hint: 'Caption (optional)', lines: 'Options, one per line: * the picked one' },
  toggle: { title: 'Toggle', group: 'Inputs', size: [180, 24], label: 'Notifications', hint: 'Caption (Accent: on)' },
  search: { title: 'Search box', group: 'Inputs', size: [240, 36], label: 'Search…', hint: 'Placeholder' },
  password: { title: 'Password field', group: 'Inputs', size: [240, 58], label: 'Password', sub: '••••••••', hint: 'Field label', lines: 'Value' },
  date: { title: 'Date picker', group: 'Inputs', size: [200, 58], label: 'Due date', sub: 'Sep 27, 2026', hint: 'Field label', lines: 'Date' },
  calendar: { title: 'Calendar', group: 'Inputs', size: [240, 220], label: 'September 2026', sub: '27', hint: 'Month', lines: 'Picked days, split by spaces' },
  slider: { title: 'Slider', group: 'Inputs', size: [240, 40], label: 'Volume', sub: '40%', hint: 'Caption', lines: 'Value, e.g. 40%' },
  rating: { title: 'Star rating', group: 'Inputs', size: [120, 22], label: '4', hint: 'Stars out of 5, e.g. 4' },
  chips: { title: 'Chips / tag input', group: 'Inputs', size: [280, 36], label: '', sub: 'design\n*frontend\nurgent', hint: 'Caption (optional)',
    lines: 'Chips, one per line: * a picked one' },
  checklist: { title: 'Checkbox list', group: 'Inputs', size: [200, 80], label: '', sub: '*Email\nSMS\n*Push', hint: 'Caption (optional)',
    lines: 'Options, one per line: * a checked one' },
  buttongroup: { title: 'Button group', group: 'Inputs', size: [240, 32], label: '', sub: 'Day\n*Week\nMonth', hint: 'Caption (optional)',
    lines: 'Buttons, one per line: * the pressed one' },
  upload: { title: 'File upload', group: 'Inputs', size: [280, 110], label: 'Drop files here or browse', hint: 'Text' },
  combobox: { title: 'Autocomplete', group: 'Inputs', size: [240, 150], label: 'City', sub: 'Lon\n*London\nLondonderry\nLong Beach', hint: 'Field label',
    lines: 'What is typed, then the suggestions, one per line: * the highlighted one' },
  numberfield: { title: 'Number stepper', group: 'Inputs', size: [160, 58], label: 'Guests', sub: '2', hint: 'Field label', lines: 'Value' },
  timepicker: { title: 'Time picker', group: 'Inputs', size: [160, 58], label: 'Start time', sub: '09:30', hint: 'Field label', lines: 'Time' },
  colorpicker: { title: 'Color picker', group: 'Inputs', size: [220, 48], label: 'Color', sub: 'red\n*orange\nyellow\ngreen\nblue\npurple\ngray', hint: 'Caption (optional)',
    lines: 'Colors, one per line (red orange yellow green blue purple gray): * the picked one' },
  heading: { title: 'Heading', group: 'Content', size: [320, 40], label: 'Page title', hint: 'Heading' },
  text: { title: 'Paragraph', group: 'Content', size: [320, 64], label: 'A sentence or two that explain this part of the page.', hint: 'Text (empty: placeholder lines)' },
  image: { title: 'Image', group: 'Content', size: [240, 150], label: '', hint: 'Caption (optional)' },
  avatar: { title: 'Avatar', group: 'Content', size: [150, 40], label: 'Ann Lee', hint: 'Name' },
  list: { title: 'List', group: 'Content', size: [240, 116], label: '', sub: 'First item\nSecond item\nThird item', hint: 'Title (optional)',
    lines: 'Items, one per line: * the selected one' },
  table: { title: 'Table', group: 'Content', size: [380, 116], label: '', sub: 'Name | Status | Date\nFix login | done | Sep 2\nCSV export | draft | Sep 5',
    hint: 'Title (optional)', lines: 'Rows, one per line, cells split by |: the first row is the header' },
  chart: { title: 'Chart', group: 'Content', size: [280, 160], label: 'Revenue', sub: '4 7 5 9 6 8', hint: 'Title', lines: 'Bar heights, split by spaces' },
  video: { title: 'Video', group: 'Content', size: [280, 160], label: '', hint: 'Caption (optional)' },
  hero: { title: 'Hero section', group: 'Content', size: [560, 220], label: 'Specs your agents can read',
    sub: 'Write the task once, share the link, get the results back.\n[Get started]\n[See how]', hint: 'Headline', lines: 'Text, then [Buttons], one per line: the first is primary' },
  stat: { title: 'Stat / KPI', group: 'Content', size: [180, 92], label: 'Revenue', sub: '$12,480\n+8% this week', hint: 'Caption', lines: 'Value, then the change (+ good, - bad)' },
  accordion: { title: 'Accordion', group: 'Content', size: [300, 150], label: '', sub: 'Shipping\n*Returns\nWarranty', hint: 'Title (optional)',
    lines: 'Sections, one per line: * the open one' },
  pricing: { title: 'Pricing card', group: 'Content', size: [220, 260], label: 'Pro', sub: '$12/mo\nUnlimited tasks\nAgent tokens\nPriority support\n[Choose Pro]',
    hint: 'Plan (Accent: highlighted)', lines: 'Price, then features, one per line, then [Button]' },
  product: { title: 'Product card', group: 'Content', size: [200, 250], label: 'Desk lamp', sub: '$49\n[Add to cart]', hint: 'Product name', lines: 'Price, then [Button]' },
  post: { title: 'Social post', group: 'Content', size: [320, 260], label: 'Ann Lee', sub: 'Shipped the new wireframes today!', hint: 'Author', lines: 'Text (a picture goes under it)' },
  chat: { title: 'Chat messages', group: 'Content', size: [280, 170], label: '', sub: 'Is the spec ready?\n*Almost, ten minutes\nGreat, thanks!', hint: 'Title (optional)',
    lines: 'Messages, one per line: * yours (on the right)' },
  timeline: { title: 'Timeline / activity', group: 'Content', size: [280, 100], label: '', sub: 'Task created · 9:00\nAgent started · 9:05\n*Asked a question · 9:20',
    hint: 'Title (optional)', lines: 'Events, one per line: * the current one' },
  kanban: { title: 'Kanban column', group: 'Content', size: [200, 200], label: 'In progress', sub: 'Fix login\nCSV export\n*Wireframes', hint: 'Column title',
    lines: 'Cards, one per line: * a highlighted one' },
  codeblock: { title: 'Code block', group: 'Content', size: [320, 90], label: '', sub: 'npm install\nnpm run dev', hint: 'File name (optional)', lines: 'Code' },
  linechart: { title: 'Line chart', group: 'Content', size: [280, 160], label: 'Signups', sub: '3 5 4 8 7 9', hint: 'Title', lines: 'Values, split by spaces' },
  piechart: { title: 'Pie chart', group: 'Content', size: [180, 160], label: 'Traffic', sub: '50 30 20', hint: 'Title', lines: 'Slices, split by spaces' },
  divider: { title: 'Divider', group: 'Content', size: [240, 16], label: '', hint: 'Text in the middle (optional)' },
  carousel: { title: 'Image carousel', group: 'Content', size: [300, 180], label: '2 / 5', hint: 'Slide shown / slides, e.g. 2 / 5' },
  avatars: { title: 'Avatar group', group: 'Content', size: [150, 36], label: '+3', sub: 'Ann Lee\nBo Chen\nCara Diaz', hint: 'More, e.g. +3 (optional)', lines: 'Names, one per line' },
  map: { title: 'Map', group: 'Content', size: [280, 180], label: '221B Baker St', hint: 'Place (optional)' },
  audio: { title: 'Audio player', group: 'Content', size: [300, 48], label: 'Episode 12', sub: '1:24 / 3:05', hint: 'Title', lines: 'Time played / length' },
  alert: { title: 'Alert', group: 'Feedback', size: [360, 44], label: 'Saved. Your changes are live.', hint: 'Message (Accent: warning)' },
  badge: { title: 'Badge', group: 'Feedback', size: [72, 24], label: 'New', hint: 'Text' },
  progressbar: { title: 'Progress bar', group: 'Feedback', size: [240, 22], label: '60%', hint: 'Percent, e.g. 60%' },
  tooltip: { title: 'Tooltip', group: 'Feedback', size: [180, 48], label: 'A helpful hint', hint: 'Text' },
  toast: { title: 'Toast / snackbar', group: 'Feedback', size: [300, 44], label: 'Task archived', sub: 'Undo', hint: 'Message', lines: 'Action (optional)' },
  banner: { title: 'Banner', group: 'Feedback', size: [640, 44], label: 'We use cookies to keep you signed in.', sub: '[Accept]', hint: 'Message (Accent: highlighted)',
    lines: 'Buttons, one per line' },
  spinner: { title: 'Loading spinner', group: 'Feedback', size: [120, 32], label: 'Loading…', hint: 'Caption (optional)' },
  skeleton: { title: 'Loading skeleton', group: 'Feedback', size: [280, 64], label: '', hint: 'Note (not drawn)' },
  emptystate: { title: 'Empty state', group: 'Feedback', size: [300, 180], label: 'No tasks yet', sub: 'Create the first one to get started.\n[New task]', hint: 'Title',
    lines: 'Text, then [Button]' },
  ring: { title: 'Progress ring', group: 'Feedback', size: [80, 80], label: '72%', hint: 'Percent, e.g. 72%' },
  coachmark: { title: 'Onboarding tip', group: 'Feedback', size: [240, 124], label: 'New: wireframes', sub: 'Drag components from the left to build a screen.\n1/3\n[Skip]\n[Next]',
    hint: 'Title', lines: 'Text, the step (1/3), then [Buttons]: the last is primary' },
  menubar: { title: 'Menu bar', group: 'Desktop', size: [560, 26], label: 'My app', sub: 'File\nEdit\n*View\nHelp', hint: 'App name', lines: 'Menus, one per line: * the open one' },
  menu: { title: 'Menu / context menu', group: 'Desktop', size: [200, 136], label: '', sub: 'Cut | ⌘X\nCopy | ⌘C\n*Paste | ⌘V\n-\nDelete', hint: 'Title (optional)',
    lines: 'Items, one per line: name | shortcut, - a separator, * the hovered one' },
  toolstrip: { title: 'Toolbar', group: 'Desktop', size: [260, 34], label: '', sub: 'B\n*I\nU\n|\nLink\nImage', hint: 'Caption (optional)',
    lines: 'Buttons, one per line: | a separator, * a pressed one' },
  tree: { title: 'Tree view', group: 'Desktop', size: [200, 140], label: '', sub: 'src\n  components\n    *Button.tsx\n  main.ts\npackage.json', hint: 'Title (optional)',
    lines: 'Items, one per line: two spaces per level, * the selected one' },
  properties: { title: 'Property inspector', group: 'Desktop', size: [240, 130], label: 'Button', sub: 'Width | 120\nHeight | 36\nColor | Orange\nVisible | on', hint: 'Title',
    lines: 'Rows, one per line: name | value' },
  statusbar: { title: 'Status bar', group: 'Desktop', size: [560, 24], label: 'Ready', sub: 'Ln 12, Col 4\nUTF-8\nTypeScript', hint: 'Status', lines: 'Items on the right, one per line' },
  console: { title: 'Terminal / console', group: 'Desktop', size: [360, 120], label: 'zsh', sub: '$ npm test\n✓ 42 passed', hint: 'Title', lines: 'Output' },
  appbar: { title: 'Mobile app bar', group: 'Mobile', size: [260, 44], label: 'Inbox', sub: 'Edit', hint: 'Title', lines: 'Actions on the right, one per line' },
  tabbar: { title: 'Mobile tab bar', group: 'Mobile', size: [260, 52], label: '', sub: '*Home\nSearch\nInbox\nProfile', hint: 'Note (not drawn)', lines: 'Tabs, one per line: * the current one' },
  bottomsheet: { title: 'Bottom sheet', group: 'Mobile', size: [260, 220], label: 'Share', hint: 'Title', frame: true },
  actionsheet: { title: 'Action sheet', group: 'Mobile', size: [260, 180], label: 'Delete this photo?', sub: '*Delete\nSave to files\nCancel', hint: 'Question (optional)',
    lines: 'Options, one per line: * destructive; the last one is Cancel' },
  fab: { title: 'Floating button', group: 'Mobile', size: [52, 52], label: '+', hint: 'Icon' },
  settings: { title: 'Settings list', group: 'Mobile', size: [260, 136], label: '', sub: 'Wi-Fi | Home\nBluetooth | on\nNotifications\nAbout', hint: 'Title (optional)',
    lines: 'Rows, one per line: name | value (on / off: a switch)' },
  notification: { title: 'Push notification', group: 'Mobile', size: [280, 76], label: 'specdrop', sub: 'Task done\nWireframes #1 finished in 12 min', hint: 'App name',
    lines: 'Title, then text' },
  otp: { title: 'Code input', group: 'Mobile', size: [240, 44], label: '42', hint: 'Digits typed so far (6 boxes)' },
  keyboard: { title: 'Mobile keyboard', group: 'Mobile', size: [260, 120], label: 'return', hint: 'Return key, e.g. Go' },
  // system: what sits behind the screen (where a form's data goes, who uses it); an arrow from a form to a db: it is stored there
  db: { title: 'Database', group: 'System', size: [120, 100], label: 'users', sub: 'email\nname\npassword_hash', hint: 'Table / collection', lines: 'Fields stored, one per line' },
  api: { title: 'API endpoint', group: 'System', size: [220, 48], label: 'POST /api/signup', sub: '201 → user id', hint: 'Method and path',
    lines: 'Notes, one per line: body, response, errors' },
  actor: { title: 'Actor / user', group: 'System', size: [70, 96], label: 'Customer', hint: 'Role' },
  server: { title: 'Backend service', group: 'System', size: [190, 52], label: 'Auth service', sub: 'issues the session', hint: 'Name', lines: 'What it does, one per line' },
  job: { title: 'Background job', group: 'System', size: [200, 52], label: 'Send welcome email', sub: 'queue: mailers', hint: 'Name',
    lines: 'Notes, one per line: queue, schedule, retries' },
  thirdparty: { title: 'Third-party service', group: 'System', size: [170, 52], label: 'Stripe', sub: 'card payments', hint: 'Name', lines: 'What it does, one per line' },
  bucket: { title: 'File storage', group: 'System', size: [180, 52], label: 'File storage', sub: 'uploads/avatars/', hint: 'Name', lines: 'Notes, one per line: path, limits' },
  mail: { title: 'Email sent', group: 'System', size: [190, 52], label: 'Welcome email', sub: 'to: the new user', hint: 'Subject / name', lines: 'Notes, one per line: to, when' },
  event: { title: 'Event / webhook', group: 'System', size: [170, 36], label: 'user.signed_up', hint: 'Event name', lines: 'Payload or listeners, one per line' },
  rule: { title: 'Rule / validation', group: 'System', size: [220, 52], label: 'Email must be unique', sub: 'else: “already taken”', hint: 'Rule',
    lines: 'Details, one per line' },
  callout: { title: 'Callout', group: 'Notes', size: [28, 28], label: '1', hint: 'Number' },
}
// the catalog's groups in order; note is the flowchart's sticky note
const CATALOG = [...new Set(Object.values(WIRES).map((w) => w.group))].map((g) => [g, [...Object.keys(WIRES).filter((k) => WIRES[k].group === g), ...(g === 'Notes' ? ['note'] : [])]] as const)

// def: shape added by double-clicking empty canvas; aliases: more words that find it in the slash menu; catalog: shapes come from a side panel
export const KINDS: Record<string, { title: string; shapes: string[]; def: string; aliases?: string[]; catalog?: boolean }> = {
  flowchart: { title: 'Flowchart', shapes: ['terminal', 'process', 'decision', 'io', 'note'], def: 'process' },
  architecture: { title: 'Architecture', shapes: ['service', 'database', 'queue', 'external', 'zone'], def: 'service' },
  state: { title: 'State machine', shapes: ['initial', 'state', 'final'], def: 'state' },
  er: { title: 'ER / data model', shapes: ['entity'], def: 'entity' },
  swimlane: { title: 'Swimlane', shapes: ['lane', 'process', 'decision', 'terminal'], def: 'process' },
  // UI specs: screens (their contents as sub lines) and the user actions between them
  screenflow: { title: 'Screen flow', shapes: ['screen', 'phone', 'action', 'note'], def: 'screen', aliases: ['wireflow'] },
  // UI mockups: components dragged from the catalog; arrows still connect them (flows, annotations)
  wireframe: { title: 'Wireframe', shapes: [...Object.keys(WIRES), 'note'], def: 'box', aliases: ['wireframe', 'mockup', 'ui', 'balsamiq', 'layout', 'screen'], catalog: true },
}

const SIZE: Record<string, [number, number]> = {
  terminal: [140, 44], process: [160, 56], decision: [150, 90], io: [160, 56], note: [170, 70],
  service: [170, 64], database: [130, 84], queue: [170, 48], external: [160, 56], zone: [380, 260],
  initial: [22, 22], state: [150, 52], final: [28, 28], entity: [210, 150], lane: [960, 170],
  screen: [220, 150], phone: [130, 220], action: [150, 36],
  ...Object.fromEntries(Object.entries(WIRES).map(([k, w]) => [k, w.size])),
}
const DEFAULTS: Record<string, { label: string; sub?: string; tag?: string }> = {
  terminal: { label: 'Start' }, process: { label: 'Step' }, decision: { label: 'Condition?' }, io: { label: 'Input' },
  note: { label: 'Note' }, service: { label: 'Service' }, database: { label: 'Database', tag: 'DB' },
  queue: { label: 'Queue' }, external: { label: 'External', tag: 'EXT' }, zone: { label: 'Zone' },
  initial: { label: '' }, state: { label: 'State' }, final: { label: '' },
  entity: { label: 'table', sub: 'id uuid PK\nname text' }, lane: { label: 'Actor' },
  screen: { label: 'Screen', sub: 'Header\nList of items\n[ Primary button ]' }, phone: { label: 'Mobile', sub: 'Title\nContent\n[ Button ]' },
  action: { label: 'Tap / click' },
  ...Object.fromEntries(Object.entries(WIRES).map(([k, w]) => [k, { label: w.label, sub: w.sub }])),
}
const CONTAINERS = ['zone', 'lane']
const BEHIND = [...CONTAINERS, ...Object.keys(WIRES).filter((k) => WIRES[k].frame)] // drawn under the other nodes
// shapes whose sub is a list, one per line
const LINES: Record<string, string> = { entity: 'Fields, one per line', screen: 'What’s on it, one per line', phone: 'What’s on it, one per line' }
const NO_TEXT = ['initial', 'final']

// Shapes CSS borders can't draw: stretched SVG outline behind the content.
const CYLINDER = <path d="M1,10 A49,9 0 0 0 99,10 A49,9 0 0 0 1,10 V90 A49,9 0 0 0 99,90 V10" />
const OUTLINE: Record<string, React.ReactNode> = {
  decision: <polygon points="50,1 99,50 50,99 1,50" />,
  io: <polygon points="12,1 99,1 88,99 1,99" />,
  database: CYLINDER, db: CYLINDER,
}

type NData = { shape: string; label: string; sub?: string; tag?: string; accent?: boolean; fill?: string; editing?: boolean }
type EData = { dashed?: boolean; accent?: boolean; editing?: boolean }
type FNode = Node<NData, 'shape'>
type FEdge = Edge<EData>

// fill: a node's background, by name (anyone with the link writes output diagrams, so never a raw CSS value);
// tinted into the theme's paper, so text stays readable in light and dark themes
export const FILLS: Record<string, string> = {
  red: '#e5484d', orange: '#f76b15', yellow: '#f5c518', green: '#30a46c', blue: '#0090ff', purple: '#8e4ec6', gray: '#8b8d98',
}
const fillStyle = (f?: string) => (f && Object.hasOwn(FILLS, f) ? { '--node-fill': `color-mix(in srgb, ${FILLS[f]} 26%, var(--sd-paper))` } as React.CSSProperties : undefined)

const ReadOnly = createContext(false)
// Editor-only: add a default node connected to `id` on `side` (clicking a connection dot).
const Spawn = createContext<((id: string, side?: string) => void) | null>(null)

function ShapeNode({ id, data, selected }: NodeProps<FNode>) {
  const readOnly = useContext(ReadOnly)
  const spawn = useContext(Spawn)
  const { updateNodeData } = useReactFlow()
  const [editing, setEditing] = useState(!!data.editing) // spawned nodes open with the label in focus
  const stopEditing = () => { setEditing(false); if (data.editing) updateNodeData(id, { editing: undefined }) }
  const s = data.shape
  // the shape names a class: an unknown one (output diagrams come from anyone with the link) must not pick up .sd-modal & co.
  const look = Object.hasOwn(SIZE, s) ? s : 'process'
  const wire = Object.hasOwn(WIRES, look)
  const fill = fillStyle(data.fill)
  // the resizer and the dots sit beside the node, not in it: shapes that clip their content (tables, screens) would clip them too
  return (<>
    <div className={`sd-node sd-${look}${wire ? ' wire' : ''}${data.accent ? ' accent' : ''}${fill ? ' filled' : ''}`} style={fill} onDoubleClick={(e) => {
      if (readOnly || NO_TEXT.includes(s)) return
      if (CONTAINERS.includes(s) && !(e.target as Element).closest('.sd-label')) return // canvas adds a node inside
      e.stopPropagation()
      setEditing(true)
    }}>
      {OUTLINE[look] && <svg className="sd-outline" viewBox="0 0 100 100" preserveAspectRatio="none">{OUTLINE[look]}</svg>}
      {editing ? <EditForm id={id} data={data} done={stopEditing} next={spawn ? () => spawn(id) : undefined} />
        : wire ? <WireArt data={data} /> : <>
          {data.tag && <span className="sd-tag">{data.tag}</span>}
          {data.label && <div className="sd-label">{data.label}</div>}
          {data.sub && <div className="sd-sub">{data.sub}</div>}
        </>}
    </div>
    {!readOnly && <NodeResizer isVisible={selected} minWidth={16} minHeight={16} />}
    {(['t', 'r', 'b', 'l'] as const).map((p) => (
      <Handle key={p} id={p} type="source" position={{ t: Position.Top, r: Position.Right, b: Position.Bottom, l: Position.Left }[p]}
        onClick={spawn && !CONTAINERS.includes(s) ? () => spawn(id, p) : undefined} />
    ))}
  </>)
}

function EditForm({ id, data, done, next }: { id: string; data: NData; done: () => void; next?: () => void }) {
  const { updateNodeData } = useReactFlow()
  const [v, setV] = useState({ label: data.label, sub: data.sub ?? '', tag: data.tag ?? '' })
  const wire = Object.hasOwn(WIRES, data.shape) ? WIRES[data.shape] : undefined
  const commit = (e?: { preventDefault(): void }) => {
    e?.preventDefault()
    updateNodeData(id, { label: v.label, sub: v.sub || undefined, tag: v.tag || undefined })
    done()
  }
  return (
    <form className="sd-edit nodrag nowheel" onSubmit={commit}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) commit() }}
      onKeyDown={(e) => {
        e.stopPropagation() // React Flow's node a11y handler swallows Enter
        const input = (e.target as Element).tagName === 'INPUT'
        if (e.key === 'Escape') done()
        else if (e.key === 'Enter' && (input || e.metaKey || e.ctrlKey)) commit(e)
      }}>
      <input autoFocus onFocus={(e) => e.target.select()} placeholder={wire?.hint ?? 'Label'} value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })}
        onKeyDown={(e) => {
          if (e.key !== 'Tab' || e.shiftKey || !next) return
          commit(e) // Tab: keep typing the next step
          next()
        }} />
      {/* a component without lines has only its text */}
      {(!wire || wire.lines) && <textarea placeholder={wire?.lines ?? LINES[data.shape] ?? 'Subtitle (optional)'} rows={wire || LINES[data.shape] ? 4 : 1}
        value={v.sub} onChange={(e) => setV({ ...v, sub: e.target.value })} />}
      {!wire && <input placeholder="Tag (optional)" value={v.tag} onChange={(e) => setV({ ...v, tag: e.target.value })} />}
      <button type="submit">OK</button>
    </form>
  )
}

// one line of a component's sub: a leading * marks the current / picked one
const lines = (sub?: string) => (sub ?? '').split('\n').filter((l) => l.trim()).map((l) => ({ on: /^\s*\*/.test(l), text: l.replace(/^\s*\*\s*/, '') }))
const on = (b: boolean, cls: string) => (b ? `${cls} on` : cls)
const Icon = ({ d, w = 12 }: { d: string; w?: number }) => (
  <svg className="w-ico" width={w} height={w} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden><path d={d} /></svg>
)
const CHEVRON = 'M3 4.5l3 3 3-3', LENS = 'M5 1.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7M7.6 7.6L10.5 10.5', CROSS = 'M3 3l6 6M9 3l-6 6', TICK = 'M2.5 6.5l2.5 2.5 4.5-5.5'
const CLOCK = 'M6 1.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M6 3.5V6l1.8 1.2'
const FIELD_ICON: Record<string, string> = {
  select: CHEVRON, timepicker: CLOCK, date: 'M2 3h8v7.5H2zM2 5.5h8M4 1.5v2M8 1.5v2', password: 'M1 6s2-3.5 5-3.5S11 6 11 6s-2 3.5-5 3.5S1 6 1 6zM6 4.8a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4',
}
const SYS_ICON: Record<string, string> = {
  server: 'M2 2h8v3.5H2zM2 6.5h8V10H2zM3.8 3.75h.01M3.8 8.25h.01', job: CLOCK,
  thirdparty: 'M3.5 9.5h5.3a2 2 0 0 0 .4-4A3 3 0 0 0 3.5 4.7a2.4 2.4 0 0 0 0 4.8z', bucket: 'M1.5 4l1.5-2.5h6L10.5 4v6.5h-9zM1.5 4h9M5 6.5h2',
  mail: 'M1.5 2.5h9v7h-9zM1.5 3l4.5 3.5L10.5 3', event: 'M7 1L2.5 7h3.5L5 11l4.5-6H6z',
  rule: 'M6 1l4 1.5v3.5c0 2.5-1.8 4.3-4 5c-2.2-.7-4-2.5-4-5V2.5zM4 6l1.5 1.5L8.2 4.8',
}
// m:ss / m:ss → how far along, in %
const played = (s?: string) => {
  const [at, of] = (s ?? '').split('/').map((p) => p.trim().split(':').reduce((a, b) => a * 60 + (parseFloat(b) || 0), 0))
  return of ? Math.min(100, Math.max(0, (at / of) * 100)) : 0
}
const Cross = () => (
  <svg className="w-cross" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
    <path d="M0 0L100 100M100 0L0 100" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" /></svg>
)
const Check = ({ on: b }: { on: boolean }) => <span className={on(b, 'w-box')}>{b && <Icon d={TICK} w={10} />}</span>
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const pct = (s?: string) => Math.min(100, Math.max(0, parseFloat(s ?? '') || 0))
const nums = (s?: string) => (s ?? '').split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 40)
// `[Text]` lines are buttons
const isBtn = (t: string) => /^\[.*\]$/.test(t)
const Btns = ({ texts, primary = -1 }: { texts: string[]; primary?: number }) => <>{texts.filter(isBtn).map((t, i) => <span key={i} className={on(i === primary, 'w-btn')}>{t.slice(1, -1)}</span>)}</>
const pairs = (texts: string[]) => texts.map((r) => { const [k, v = ''] = r.split('|').map((c) => c.trim()); return [k, v] })
const SLICES = ['var(--accent)', 'var(--sd-link)', 'var(--sd-ok)', 'var(--sd-node-stroke)', 'var(--sd-bad)', 'var(--sd-soft)']

// what a catalog component looks like; everything is driven by its text, so an agent can write one as JSON too
function WireArt({ data: { shape, label, sub, accent } }: { data: NData }) {
  const items = lines(sub)
  const texts = items.map((it) => it.text)
  const title = label && <div className="w-title">{label}</div>
  switch (shape) {
    case 'window': case 'appwindow': return <><div className="w-bar"><span className="w-dots" /><span className="w-url">{label}</span></div><div className="w-body" /></>
    case 'mobile': case 'tablet': return <><div className="w-status"><span>9:41</span><span>▮▮▮</span></div>{title}<div className="w-body" /></>
    case 'dialog': return <>
      <div className="w-title">{label}<Icon d={CROSS} /></div><div className="w-text w-body">{sub}</div>
      <div className="w-foot"><span className="w-btn">Cancel</span><span className="w-btn on">OK</span></div></>
    case 'panel': case 'drawer': return <><div className="w-title">{label}<Icon d={shape === 'panel' ? CHEVRON : CROSS} /></div><div className="w-body" /></>
    case 'bottomsheet': return <><span className="w-grab" />{title}<div className="w-body" /></>
    case 'card': return <>{title}<div className="w-text">{sub}</div></>
    case 'box': case 'image': case 'video': return <>
      {shape === 'image' && <Cross />}
      {shape === 'video' && <span className="w-play" />}
      {label && <span className="w-cap">{label}</span>}</>
    case 'navbar': case 'footer': return <>
      <span className={shape === 'navbar' ? 'w-logo' : 'w-small'}>{label}</span><span className="w-grow" />
      {items.map((it, i) => (isBtn(it.text)
        ? <span key={i} className="w-btn">{it.text.slice(1, -1)}</span>
        : <span key={i} className={on(it.on, 'w-link')}>{it.text}</span>))}</>
    case 'sidebar': case 'list': case 'radio': case 'checklist': return <>
      {title}
      {items.map((it, i) => <div key={i} className={on(it.on, 'w-item')}>
        {shape === 'radio' && <span className={on(it.on, 'w-dot')} />}{shape === 'checklist' && <Check on={it.on} />}{it.text}</div>)}</>
    case 'tabs': return <>{label && <span className="w-small">{label}</span>}{items.map((it, i) => <span key={i} className={on(it.on, 'w-tab')}>{it.text}</span>)}</>
    case 'breadcrumbs': return <>{label.split('/').map((p, i, all) => <span key={i} className={i === all.length - 1 ? 'w-here' : 'w-link'}>{p.trim()}</span>)}</>
    case 'pagination': return <>{label.split(/\s+/).filter(Boolean).map((p, i) => <span key={i} className={on(p.startsWith('*'), 'w-page')}>{p.replace(/^\*/, '')}</span>)}</>
    case 'stepper': {
      const at = items.findIndex((it) => it.on)
      return <>{label && <span className="w-small">{label}</span>}{items.map((it, i) => (
        <span key={i} className={on(it.on, `w-step${i < at ? ' done' : ''}`)}><b>{i < at ? '✓' : i + 1}</b>{it.text}</span>))}</>
    }
    case 'button': case 'badge': case 'callout': case 'heading': case 'link': case 'iconbutton': case 'fab': return <span className="w-cap">{label}</span>
    case 'input': case 'textarea': case 'select': case 'date': case 'password': case 'timepicker': return <>
      {label && <span className="w-small">{label}</span>}
      <div className="w-field"><span>{sub}</span>{Object.hasOwn(FIELD_ICON, shape) && <Icon d={FIELD_ICON[shape]} />}</div></>
    case 'checkbox': return <><Check on={!!accent} /><span>{label}</span></>
    case 'toggle': return <><span className={on(!!accent, 'w-toggle')} /><span>{label}</span></>
    case 'search': return <><Icon d={LENS} /><span>{label}</span></>
    case 'calendar': { // ponytail: every month has 30 days from a Monday; a real month grid when someone needs it
      const picked = new Set((sub ?? '').split(/[\s,]+/))
      return <><div className="w-title"><span>‹</span>{label}<span>›</span></div><div className="w-days">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <b key={i}>{d}</b>)}
        {Array.from({ length: 30 }, (_, i) => <span key={i} className={on(picked.has(String(i + 1)), 'w-day')}>{i + 1}</span>)}</div></>
    }
    case 'slider': return <>{label && <span className="w-small">{label} · {sub}</span>}<span className="w-track"><i style={{ width: `${pct(sub)}%` }} /><b style={{ left: `${pct(sub)}%` }} /></span></>
    case 'rating': {
      const n = Math.round(Math.min(5, Math.max(0, parseFloat(label) || 0)))
      return <span className="w-stars">{'★'.repeat(n)}<i>{'★'.repeat(5 - n)}</i></span>
    }
    case 'chips': return <>{label && <span className="w-small">{label}</span>}{items.map((it, i) => <span key={i} className={on(it.on, 'w-chip')}>{it.text}<Icon d={CROSS} w={8} /></span>)}</>
    case 'buttongroup': return <>{label && <span className="w-small">{label}</span>}<span className="w-segs">{items.map((it, i) => <span key={i} className={on(it.on, 'w-seg')}>{it.text}</span>)}</span></>
    case 'combobox': {
      const [typed, ...opts] = items
      return <>{label && <span className="w-small">{label}</span>}
        <div className="w-field"><span>{typed?.text}</span><Icon d={CHEVRON} /></div>
        <div className="w-drop">{opts.map((it, i) => <div key={i} className={on(it.on, 'w-item')}>{it.text}</div>)}</div></>
    }
    case 'numberfield': return <>{label && <span className="w-small">{label}</span>}<div className="w-field"><b>−</b><span>{sub}</span><b>+</b></div></>
    case 'colorpicker': return <>{label && <span className="w-small">{label}</span>}<span className="w-swatches">{items.map((it, i) => (
      <i key={i} className={on(it.on, 'w-swatch')} title={it.text} style={{ background: Object.hasOwn(FILLS, it.text) ? FILLS[it.text] : 'var(--sd-surface)' }} />))}</span></>
    case 'upload': return <><Icon d="M6 9V2.5M3.5 5L6 2.5L8.5 5M2 10.5h8" w={20} /><span className="w-cap">{label}</span></>
    case 'text': return label ? <span className="w-text">{label}</span> : <span className="w-bars"><i /><i /><i /></span>
    case 'avatar': return <><span className="w-face">{initials(label)}</span><span>{label}</span></>
    case 'table': case 'properties': {
      const rows = shape === 'table' ? texts.map((r) => r.split('|').map((c) => c.trim())) : pairs(texts)
      return <>{title}<table><tbody>{rows.map((r, i) => (
        <tr key={i}>{r.map((c, j) => (i || shape !== 'table' ? <td key={j}>{c}</td> : <th key={j}>{c}</th>))}</tr>))}</tbody></table></>
    }
    case 'chart': case 'linechart': case 'piechart': {
      const ns = nums(sub)
      const max = Math.max(1, ...ns)
      const total = ns.reduce((a, b) => a + b, 0) || 1
      let from = 0
      const slices = ns.map((n, i) => `${SLICES[i % SLICES.length]} ${from}% ${(from += (n / total) * 100)}%`)
      return <>{label && <div className="w-small">{label}</div>}
        {shape === 'chart' && <div className="w-chart">{ns.map((n, i) => <i key={i} style={{ height: `${(n / max) * 100}%` }} />)}</div>}
        {shape === 'linechart' && <svg className="w-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <polyline points={ns.map((n, i) => `${ns.length > 1 ? (i / (ns.length - 1)) * 100 : 50},${100 - (n / max) * 100}`).join(' ')}
            fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>}
        {shape === 'piechart' && <span className="w-pie" style={{ background: `conic-gradient(${slices.join(', ') || 'var(--sd-surface) 0 100%'})` }} />}</>
    }
    case 'hero': case 'emptystate': return <>
      {shape === 'emptystate' && <Icon d="M1.5 6.5l1.5-4.5h6l1.5 4.5v3h-9zM1.5 6.5h3l.5 1.5h2l.5-1.5h3" w={28} />}
      <div className="w-head">{label}</div>
      {texts.filter((t) => !isBtn(t)).map((t, i) => <div key={i} className="w-text">{t}</div>)}
      {texts.some(isBtn) && <div className="w-foot"><Btns texts={texts} primary={0} /></div>}</>
    case 'stat': {
      const [value, change] = texts
      return <><span className="w-small">{label}</span><b className="w-big">{value}</b>
        {change && <span className={/^[-−]/.test(change) ? 'w-down' : 'w-up'}>{change}</span>}</>
    }
    case 'accordion': return <>{title}{items.map((it, i) => (
      <div key={i} className={on(it.on, 'w-sec')}><div className="w-row">{it.text}<Icon d={CHEVRON} /></div>{it.on && <span className="w-bars"><i /><i /></span>}</div>))}</>
    case 'pricing': case 'product': {
      const [price, ...rest] = texts
      return <>{shape === 'product' && <div className="w-img"><Cross /></div>}
        <div className={shape === 'pricing' ? 'w-small' : 'w-name'}>{label}</div><b className="w-big">{price}</b>
        {rest.filter((t) => !isBtn(t)).map((t, i) => <div key={i} className="w-feat"><Icon d={TICK} w={10} />{t}</div>)}
        <span className="w-grow" /><Btns texts={rest} primary={0} /></>
    }
    case 'post': return <>
      <div className="w-head"><span className="w-face">{initials(label)}</span><b>{label}</b><span className="w-small">2h</span></div>
      <div className="w-text">{sub}</div><div className="w-img"><Cross /></div>
      <div className="w-acts"><span>♡ Like</span><span>↩ Reply</span><span>↗ Share</span></div></>
    case 'chat': return <>{title}{items.map((it, i) => <span key={i} className={on(it.on, 'w-msg')}>{it.text}</span>)}</>
    case 'timeline': return <>{title}{items.map((it, i) => <div key={i} className={on(it.on, 'w-event')}>{it.text}</div>)}</>
    case 'kanban': return <><div className="w-title">{label}<span className="w-small">{items.length}</span></div>
      {items.map((it, i) => <div key={i} className={on(it.on, 'w-card')}>{it.text}</div>)}</>
    case 'codeblock': case 'console': return <>
      {(label || shape === 'console') && <div className="w-bar">{shape === 'console' && <span className="w-dots" />}<span className="w-small">{label}</span></div>}
      <pre>{sub}</pre></>
    case 'divider': return label ? <span className="w-small">{label}</span> : null
    case 'carousel': {
      const [at, of] = label.split('/').map((n) => parseInt(n))
      const n = Math.min(12, Math.max(1, of || 1))
      return <><Cross /><span className="w-arrow">‹</span><span className="w-arrow">›</span>
        <span className="w-dots-row">{Array.from({ length: n }, (_, i) => <i key={i} className={i + 1 === Math.min(n, Math.max(1, at || 1)) ? 'on' : ''} />)}</span></>
    }
    case 'avatars': return <>{texts.map((t, i) => <span key={i} className="w-face">{initials(t)}</span>)}{label && <span className="w-face w-more">{label}</span>}</>
    case 'map': return <><Icon d="M6 11s3.5-3.6 3.5-6.5a3.5 3.5 0 0 0-7 0C2.5 7.4 6 11 6 11zM6 3.3a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4" w={28} />
      {label && <span className="w-cap">{label}</span>}</>
    case 'audio': return <><span className="w-play" /><span className="w-sys"><span className="w-cap">{label}</span>
      <span className="w-track"><i style={{ width: `${played(sub)}%` }} /></span></span><span className="w-small">{sub}</span></>
    case 'ring': return <span className="w-ring" style={{ background: `conic-gradient(var(--accent) ${pct(label)}%, var(--sd-surface) 0)` }}><b>{label}</b></span>
    case 'coachmark': {
      const step = texts.find((t) => /^\d+\s*\/\s*\d+$/.test(t))
      return <><div className="w-head">{label}<Icon d={CROSS} /></div>
        {texts.filter((t) => t !== step && !isBtn(t)).map((t, i) => <div key={i} className="w-text">{t}</div>)}
        <div className="w-foot">{step && <span className="w-small w-grow">{step}</span>}<Btns texts={texts} primary={texts.filter(isBtn).length - 1} /></div></>
    }
    case 'db': return <><b className="w-cap">{label}</b>{texts.map((t, i) => <span key={i} className="w-small">{t}</span>)}</>
    case 'actor': return <>
      <svg className="w-actor" viewBox="0 0 24 40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="6" r="5" /><path d="M12 11v15M3 17h18M12 26l-8 12M12 26l8 12" /></svg>
      <span className="w-cap">{label}</span></>
    case 'api': {
      const m = /^(GET|POST|PUT|PATCH|DELETE)\s+(.*)$/i.exec(label)
      return <><span className="w-row">{m && <b className="w-method">{m[1].toUpperCase()}</b>}<span className="w-cap">{m ? m[2] : label}</span></span>
        {texts.map((t, i) => <span key={i} className="w-small">{t}</span>)}</>
    }
    case 'server': case 'job': case 'thirdparty': case 'bucket': case 'mail': case 'event': case 'rule': return <><Icon d={SYS_ICON[shape]} w={18} />
      <span className="w-sys"><b className="w-cap">{label}</b>{texts.map((t, i) => <span key={i} className="w-small">{t}</span>)}</span></>
    case 'alert': return <><Icon d="M6 1.5v6M6 10v.5" /><span>{label}</span></>
    case 'progressbar': return <><span className="w-track"><i style={{ width: `${pct(label)}%` }} /></span><span className="w-small">{label}</span></>
    case 'tooltip': return <span className="w-tip">{label}</span>
    case 'toast': return <><span className="w-cap">{label}</span>{texts[0] && <b>{texts[0]}</b>}</>
    case 'banner': return <><span className="w-cap w-grow">{label}</span>
      {texts.map((t, i) => <span key={i} className={on(i === 0, 'w-btn')}>{isBtn(t) ? t.slice(1, -1) : t}</span>)}<Icon d={CROSS} /></>
    case 'spinner': return <><span className="w-spin" />{label && <span className="w-small">{label}</span>}</>
    case 'skeleton': return <><span className="w-face" /><span className="w-bars"><i /><i /><i /></span></>
    case 'menubar': return <><b className="w-logo">{label}</b>{items.map((it, i) => <span key={i} className={on(it.on, 'w-menu')}>{it.text}</span>)}</>
    case 'menu': return <>{label && <div className="w-small">{label}</div>}{items.map((it, i) => (it.text === '-' ? <hr key={i} />
      : <div key={i} className={on(it.on, 'w-item')}><span>{it.text.split('|')[0].trim()}</span><span className="w-small">{it.text.split('|')[1]?.trim()}</span></div>))}</>
    case 'toolstrip': return <>{label && <span className="w-small">{label}</span>}
      {items.map((it, i) => (it.text === '|' ? <span key={i} className="w-sep" /> : <span key={i} className={on(it.on, 'w-tool')}>{it.text}</span>))}</>
    case 'tree': {
      const rows = (sub ?? '').split('\n').filter((l) => l.trim())
        .map((l) => ({ depth: Math.min(8, Math.floor(l.search(/\S/) / 2)), on: /^\s*\*/.test(l), text: l.replace(/^\s*\*?\s*/, '') }))
      return <>{title}{rows.map((r, i) => (
        <div key={i} className={on(r.on, 'w-item')} style={{ paddingLeft: 6 + r.depth * 12 }}><i>{(rows[i + 1]?.depth ?? 0) > r.depth ? '▾' : ''}</i>{r.text}</div>))}</>
    }
    case 'statusbar': return <><span className="w-cap w-grow">{label}</span>{texts.map((t, i) => <span key={i}>{t}</span>)}</>
    case 'appbar': return <><span className="w-back">‹</span><b className="w-cap">{label}</b><span className="w-acts">{texts.map((t, i) => <span key={i}>{t}</span>)}</span></>
    case 'tabbar': return <>{items.map((it, i) => <span key={i} className={on(it.on, 'w-tabi')}><i />{it.text}</span>)}</>
    case 'actionsheet': {
      const cancel = items.at(-1)
      return <><div className="w-group">{label && <div className="w-small">{label}</div>}
        {items.slice(0, -1).map((it, i) => <div key={i} className={on(it.on, 'w-opt')}>{it.text}</div>)}</div>
        {cancel && <div className="w-group"><div className="w-opt w-cancel">{cancel.text}</div></div>}</>
    }
    case 'settings': return <>{label && <div className="w-small">{label}</div>}{pairs(texts).map(([k, v], i) => (
      <div key={i} className="w-row"><span>{k}</span><span className="w-grow" />
        {v === 'on' || v === 'off' ? <span className={on(v === 'on', 'w-toggle')} /> : <span className="w-small">{v} ›</span>}</div>))}</>
    case 'notification': {
      const [head, ...rest] = texts
      return <><div className="w-head"><i className="w-app" /><span className="w-small w-grow">{label}</span><span className="w-small">now</span></div>
        <b>{head}</b><span className="w-text">{rest.join('\n')}</span></>
    }
    case 'otp': { // ponytail: always 6 boxes
      const ds = [...label.replace(/\s/g, '')].slice(0, 6)
      return <>{Array.from({ length: 6 }, (_, i) => <span key={i} className={on(i === ds.length, 'w-digit')}>{ds[i]}</span>)}</>
    }
    case 'keyboard': return <>{['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((r) => <div key={r} className="w-keys">{[...r].map((k) => <i key={k}>{k}</i>)}</div>)}
      <div className="w-keys"><i className="w-space">space</i><i className="w-ret">{label || 'return'}</i></div></>
    default: return null
  }
}

// the side panel of a wireframe: every component as a small live preview, grouped; drag one onto the canvas or click it
const DRAG = 'application/x-specdrop-shape'
function Catalog({ onAdd }: { onAdd: (shape: string) => void }) {
  const [q, setQ] = useState('')
  const match = (k: string) => `${WIRES[k]?.title ?? 'Sticky note'} ${WIRES[k]?.group ?? ''} ${k}`.toLowerCase().includes(q.trim().toLowerCase())
  const groups = CATALOG.map(([g, ks]) => [g, ks.filter(match)] as const).filter(([, ks]) => ks.length)
  return (
    <aside className="wire-catalog" aria-label="Components">
      <input className="field" type="search" placeholder="find a component…" aria-label="Find a component" value={q} onChange={(e) => setQ(e.target.value)} />
      {groups.map(([g, ks]) => (
        <section key={g}>
          <p className="eyebrow">{g.toLowerCase()}</p>
          <div className="wire-tiles">{ks.map((k) => {
            const [w, h] = SIZE[k]
            const title = WIRES[k]?.title ?? 'Sticky note'
            return (
              // not a <button>: Firefox won't start a drag from one
              <div key={k} className="wire-tile" role="button" tabIndex={0} draggable title={`${title}: drag onto the canvas, or click to add`} aria-label={`Add ${title}`}
                onDragStart={(e) => { e.dataTransfer.setData(DRAG, k); e.dataTransfer.effectAllowed = 'copy' }} onClick={() => onAdd(k)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAdd(k) } }}>
                <span className="wire-thumb" aria-hidden>
                  <span className={`sd-node sd-${k}${WIRES[k] ? ' wire' : ''}`} style={{ width: w, height: h, transform: `scale(${Math.min(1, 84 / w, 44 / h)})` }}>
                    {WIRES[k] ? <WireArt data={{ shape: k, ...DEFAULTS[k] }} /> : <div className="sd-label">{DEFAULTS[k].label}</div>}
                  </span>
                </span>
                <span className="wire-name">{title}</span>
              </div>
            )
          })}</div>
        </section>
      ))}
      {!groups.length && <p className="menu-note">no such component</p>}
    </aside>
  )
}

const nodeTypes = { shape: ShapeNode }

function LabelEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, data, style, markerEnd }: EdgeProps<FEdge>) {
  const readOnly = useContext(ReadOnly)
  const { setEdges } = useReactFlow<FNode, FEdge>()
  const [path, x, y] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 6 })
  const editing = !readOnly && data?.editing
  const set = (patch: Partial<FEdge>) => setEdges((es) => es.map((e) => (e.id === id ? { ...e, ...patch, data: { ...e.data, editing: false } } : e)))
  return (
    <>
      <BaseEdge path={path} style={style} markerEnd={markerEnd} interactionWidth={18} />
      {(label || editing) && (
        <EdgeLabelRenderer>
          <div className={`sd-edge-label nodrag nopan${data?.accent ? ' accent' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
            onDoubleClick={() => !readOnly && setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { ...e.data, editing: true } } : e)))}>
            {editing
              ? <input autoFocus defaultValue={(label as string) ?? ''} placeholder="label"
                  onBlur={(e) => set({ label: e.target.value.trim() || undefined })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') { e.currentTarget.value = (label as string) ?? ''; e.currentTarget.blur() }
                  }} />
              : label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const edgeTypes = { label: LabelEdge }

const edgeLook = (d: EData) => ({
  type: 'label',
  data: d,
  style: { stroke: d.accent ? 'var(--accent)' : 'var(--sd-edge)', strokeWidth: d.accent ? 1.6 : 1.2, strokeDasharray: d.dashed ? '5 4' : undefined },
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: d.accent ? 'var(--accent)' : 'var(--sd-edge)' },
})

function newNode(shape: string, x: number, y: number, id = crypto.randomUUID().slice(0, 8)): FNode {
  const [w, h] = Object.hasOwn(SIZE, shape) ? SIZE[shape] : [160, 56] // not SIZE['constructor']: shapes come from anyone with the link
  return {
    id, type: 'shape', position: { x, y }, width: w, height: h,
    zIndex: BEHIND.includes(shape) ? -1 : 0, data: { shape, ...DEFAULTS[shape] },
  }
}

// Nodes without x/y (typical for AI-written diagrams) get a left-to-right layered layout.
export function layout(d: Diagram): Diagram {
  d = { ...d, nodes: d.nodes ?? [], edges: d.edges ?? [] } // output rows are written by anyone with the link
  const inner = d.nodes.filter((n) => !CONTAINERS.includes(n.shape))
  const incoming = new Set(d.edges.map((e) => e.to))
  const level = new Map<string, number>()
  const queue = inner.filter((n) => !incoming.has(n.id)).map((n) => n.id)
  if (!queue.length && inner[0]) queue.push(inner[0].id)
  queue.forEach((id) => level.set(id, 0))
  for (let i = 0; i < queue.length; i++)
    for (const e of d.edges)
      if (e.from === queue[i] && !level.has(e.to)) { level.set(e.to, level.get(queue[i])! + 1); queue.push(e.to) }
  // columns 240 apart and rows 120, more where a node is bigger (screens, tables)
  const size = (n: Diagram['nodes'][number]) => [n.w ?? SIZE[n.shape]?.[0] ?? 160, n.h ?? SIZE[n.shape]?.[1] ?? 56]
  const widest = new Map<number, number>()
  for (const n of inner) if (n.x == null || n.y == null) widest.set(level.get(n.id) ?? 0, Math.max(widest.get(level.get(n.id) ?? 0) ?? 0, size(n)[0]))
  const colX = (l: number) => Array.from({ length: l }, (_, i) => Math.max(240, (widest.get(i) ?? 0) + 80)).reduce((a, b) => a + b, 0)
  const nextY = new Map<number, number>()
  return {
    ...d,
    nodes: d.nodes.map((n) => {
      if (n.x != null && n.y != null) return n
      const l = level.get(n.id) ?? 0
      const y = nextY.get(l) ?? 0
      nextY.set(l, y + Math.max(120, size(n)[1] + 40))
      return { ...n, x: colX(l), y }
    }),
  }
}

const side = (dx: number, dy: number) => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : dy > 0 ? 'b' : 't')
const opposite: Record<string, string> = { r: 'l', l: 'r', t: 'b', b: 't' }

export function toFlow(d: Diagram): { nodes: FNode[]; edges: FEdge[] } {
  const nodes = d.nodes.map((n) => {
    const node = newNode(n.shape, n.x ?? 0, n.y ?? 0, n.id)
    node.data = { shape: n.shape, label: n.label ?? '', sub: n.sub, tag: n.tag, accent: n.accent, fill: n.fill }
    if (n.w) node.width = n.w
    if (n.h) node.height = n.h
    if (n.z != null) node.zIndex = n.z
    return node
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const center = (n: FNode) => ({ x: n.position.x + (n.width ?? 0) / 2, y: n.position.y + (n.height ?? 0) / 2 })
  const edges = d.edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((e: DiagramEdge, i): FEdge => {
    const a = center(byId.get(e.from)!), b = center(byId.get(e.to)!)
    const s = e.fromSide ?? side(b.x - a.x, b.y - a.y)
    return {
      id: e.id ?? `e${i}`, source: e.from, target: e.to, label: e.label,
      sourceHandle: s, targetHandle: e.toSide ?? opposite[s], ...edgeLook({ dashed: e.dashed, accent: e.accent }),
    }
  })
  return { nodes, edges }
}

function fromFlow(kind: string, nodes: FNode[], edges: FEdge[]): Diagram {
  return {
    kind,
    nodes: nodes.map((n) => ({
      id: n.id, shape: n.data.shape, label: n.data.label, sub: n.data.sub, tag: n.data.tag, accent: n.data.accent || undefined, fill: n.data.fill,
      x: Math.round(n.position.x), y: Math.round(n.position.y),
      w: Math.round(n.width ?? n.measured?.width ?? 0), h: Math.round(n.height ?? n.measured?.height ?? 0), z: n.zIndex ?? 0,
    })),
    edges: edges.map((e) => ({
      id: e.id, from: e.source, to: e.target, fromSide: e.sourceHandle ?? undefined, toSide: e.targetHandle ?? undefined,
      label: (e.label as string) || undefined, dashed: e.data?.dashed || undefined, accent: e.data?.accent || undefined,
    })),
  }
}

const dims = (n: FNode) => ({ w: n.width ?? n.measured?.width ?? 0, h: n.height ?? n.measured?.height ?? 0 })

// ⌘C / ⌘X: the selected nodes and the arrows between them, kept for ⌘V in this diagram or another one on the page.
// ponytail: in memory, not the system clipboard, so it doesn't reach other tabs
let clipboard: { nodes: FNode[]; edges: FEdge[]; pasted: number } | null = null
const mid = (n: FNode) => ({ x: n.position.x + dims(n).w / 2, y: n.position.y + dims(n).h / 2 })

// Move nodes so connected handles share an axis and smoothstep arrows draw as one straight segment.
// 2+ nodes selected: line them up on a row/column (whichever they already spread along), anchored on the first.
// 1 node selected: align it to its first neighbour. Otherwise: align each selected arrow's target to its source.
export function straightened(nodes: FNode[], edges: FEdge[]): FNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const moves = new Map<string, { x?: number; y?: number }>()
  const align = (move: FNode, to: FNode) => {
    const a = mid(to), b = mid(move)
    moves.set(move.id, Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { y: a.y } : { x: a.x })
  }
  const sel = nodes.filter((n) => n.selected && !CONTAINERS.includes(n.data.shape))
  if (sel.length >= 2) {
    const xs = sel.map((n) => mid(n).x), ys = sel.map((n) => mid(n).y)
    const row = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys)
    const anchor = sel.reduce((a, n) => ((row ? mid(n).x < mid(a).x : mid(n).y < mid(a).y) ? n : a))
    for (const n of sel) moves.set(n.id, row ? { y: mid(anchor).y } : { x: mid(anchor).x })
  } else if (sel.length === 1) {
    const e = edges.find((e) => e.source === sel[0].id || e.target === sel[0].id)
    const other = e && byId.get(e.source === sel[0].id ? e.target : e.source)
    if (other) align(sel[0], other)
  } else {
    for (const e of edges.filter((e) => e.selected)) {
      const s = byId.get(e.source), t = byId.get(e.target)
      if (s && t) align(t, s)
    }
  }
  return nodes.map((n) => {
    const m = moves.get(n.id)
    if (!m) return n
    const { w, h } = dims(n)
    return { ...n, position: { x: m.x != null ? m.x - w / 2 : n.position.x, y: m.y != null ? m.y - h / 2 : n.position.y } }
  })
}

type Box = { x: number; y: number; w: number; h: number }
export type Guide = { x1: number; y1: number; x2: number; y2: number }
// Dragging one node: its left / center / right (top / middle / bottom) snaps to another node's within `tol`;
// the guides are the lines it then shares with the others, drawn from it to them
export function snap(b: Box, others: Box[], tol = 6): { x: number; y: number; guides: Guide[] } {
  const xs = (o: Box) => [o.x, o.x + o.w / 2, o.x + o.w], ys = (o: Box) => [o.y, o.y + o.h / 2, o.y + o.h]
  const nearest = (mine: number[], theirs: number[]) => {
    let d = Infinity
    for (const t of theirs) for (const m of mine) if (Math.abs(t - m) < Math.abs(d)) d = t - m
    return Math.abs(d) <= tol ? d : 0
  }
  const x = b.x + nearest(xs(b), others.flatMap(xs)), y = b.y + nearest(ys(b), others.flatMap(ys))
  const s = { ...b, x, y }
  const guides: Guide[] = []
  for (const o of others) {
    for (const t of xs(o)) if (xs(s).some((m) => Math.abs(m - t) < 0.5)) guides.push({ x1: t, x2: t, y1: Math.min(s.y, o.y), y2: Math.max(s.y + s.h, o.y + o.h) })
    for (const t of ys(o)) if (ys(s).some((m) => Math.abs(m - t) < 0.5)) guides.push({ y1: t, y2: t, x1: Math.min(s.x, o.x), x2: Math.max(s.x + s.w, o.x + o.w) })
  }
  return { x, y, guides }
}

async function exportPng(nodes: FNode[]): Promise<Blob | null> {
  const el = document.querySelector<HTMLElement>('.sd-modal .react-flow__viewport')
  if (!el || !nodes.length) return null
  const b = getNodesBounds(nodes)
  const w = Math.min(3000, b.width + 80), h = Math.min(3000, b.height + 80)
  const vp = getViewportForBounds(b, w, h, 0.1, 2, '40px')
  // html-to-image loses CSS-var fills on SVG children: pin them inline for the capture
  const outlines = [...el.querySelectorAll<SVGElement>('.sd-outline > *')]
  for (const o of outlines) { const cs = getComputedStyle(o); o.style.fill = cs.fill; o.style.stroke = cs.stroke }
  const modal = el.closest('.sd-modal')!
  modal.classList.add('exporting')
  try {
    // toBlob, not toPng + fetch(data:): the packaged app's CSP (connect-src) refuses a data: fetch
    return await toBlob(el, {
      backgroundColor: getComputedStyle(document.body).getPropertyValue('--sd-paper').trim(),
      width: w, height: h, pixelRatio: 2, skipFonts: true,
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
      filter: (n) => !(n instanceof Element && /react-flow__(handle|resize-control)/.test(n.className as string)),
    })
  } finally {
    modal.classList.remove('exporting')
    for (const o of outlines) { o.style.fill = ''; o.style.stroke = '' }
  }
}

type EditorProps = { value: Diagram; onSave: (d: Diagram, png: Blob | null) => Promise<void>; onCancel: () => void }

export function DiagramEditor(props: EditorProps) {
  return <ReactFlowProvider><Editor {...props} /></ReactFlowProvider>
}

function Editor({ value, onSave, onCancel }: EditorProps) {
  const init = useMemo(() => toFlow(layout(value)), [value])
  const [nodes, setNodes, onNodesChange] = useNodesState(init.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(init.edges)
  const [busy, setBusy] = useState(false)
  const [guides, setGuides] = useState<Guide[]>([])
  const rf = useReactFlow()
  // one node dragged: snap it to the others' edges and centers, and show the lines it lines up on.
  // The drop resends React Flow's own position: snap that too (but not arrow-key nudges)
  const dragging = useRef(false)
  const onChange = (cs: NodeChange<FNode>[]) => {
    const c = cs.length === 1 && cs[0].type === 'position' ? cs[0] : undefined
    const me = c?.position && (c.dragging || dragging.current) ? rf.getNode(c.id) as FNode | undefined : undefined
    if (c?.type === 'position' && c.position && me) {
      const others = (rf.getNodes() as FNode[]).filter((n) => n.id !== me.id).map((n) => ({ ...n.position, ...dims(n) }))
      const s = snap({ ...c.position, ...dims(me) }, others, 6 / rf.getZoom()) // 6 screen px at any zoom
      cs = [{ ...c, position: { x: s.x, y: s.y } }]
      setGuides(c.dragging ? s.guides : [])
    } else if (cs.some((c) => c.type === 'position' && !c.dragging)) setGuides([])
    if (cs.some((c) => c.type === 'position')) dragging.current = !!c?.dragging
    onNodesChange(cs)
  }
  const kind = KINDS[value.kind] ? value.kind : 'flowchart'
  const catalog = !!KINDS[kind].catalog

  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, ...edgeLook({}) }, es)), [setEdges])
  const addAt = (shape: string, p: XYPosition) => {
    const [w, h] = SIZE[shape]
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...newNode(shape, p.x - w / 2, p.y - h / 2), selected: true }])
  }
  const add = (shape: string) => {
    const r = document.querySelector('.sd-modal .react-flow')!.getBoundingClientRect()
    const shift = (nodes.length % 8) * 24 // cascade so new nodes don't stack exactly
    addAt(shape, rf.screenToFlowPosition({ x: r.x + r.width / 2 + shift, y: r.y + r.height / 2 + shift }))
  }
  const editLabel = () => {
    const e = edges.find((x) => x.selected)
    if (e) setEdges((es) => es.map((x) => (x.id === e.id ? { ...x, data: { ...x.data, editing: true } } : x)))
  }
  const straighten = () => setNodes((ns) => straightened(ns, edges))

  // New default node next to `fromId`, connected from its `side` handle, label opened for typing.
  // Side defaults to the one the node already flows out of, else right.
  const spawn = useCallback((fromId: string, side?: string) => {
    const from = rf.getNode(fromId) as FNode | undefined
    if (!from || CONTAINERS.includes(from.data.shape)) return
    const all = rf.getNodes() as FNode[]
    const s = side ?? (rf.getEdges() as FEdge[]).find((e) => e.source === fromId)?.sourceHandle ?? 'r'
    const shape = KINDS[kind].def
    const [w, h] = SIZE[shape]
    const f = dims(from), c = mid(from)
    const [dx, dy] = ({ r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1] } as Record<string, number[]>)[s]
    let x = dx ? c.x + dx * (f.w / 2 + 80 + w / 2) : c.x
    let y = dy ? c.y + dy * (f.h / 2 + 64 + h / 2) : c.y
    const taken = (x: number, y: number) => all.some((n) => !CONTAINERS.includes(n.data.shape)
      && Math.abs(mid(n).x - x) < (dims(n).w + w) / 2 + 8 && Math.abs(mid(n).y - y) < (dims(n).h + h) / 2 + 8)
    for (let i = 0; i < 12 && taken(x, y); i++) { if (dx) y += h + 32; else x += w + 32 } // slide sideways to a free spot
    const node = { ...newNode(shape, x - w / 2, y - h / 2), selected: true }
    node.data = { ...node.data, editing: true }
    // rf.* shares React Flow's update queue with updateNodeData, so a label commit can't re-select the old node
    rf.setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), node])
    rf.setEdges((es) => [...es.map((e) => ({ ...e, selected: false })),
      { id: `e-${node.id}`, source: fromId, target: node.id, sourceHandle: s, targetHandle: opposite[s], ...edgeLook({}) }])
    const r = document.querySelector('.sd-modal .react-flow')!.getBoundingClientRect()
    const p = rf.flowToScreenPosition({ x, y })
    if (p.x < r.left + w || p.x > r.right - w || p.y < r.top + h || p.y > r.bottom - h)
      rf.setCenter(x, y, { zoom: rf.getZoom(), duration: 250 })
  }, [rf, kind])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).isContentEditable || (e.target as Element).closest('input, textarea')) return
      const sel = (rf.getNodes() as FNode[]).filter((n) => n.selected)
      const key = e.metaKey || e.ctrlKey ? e.key.toLowerCase() : ''
      if ((key === 'c' || key === 'x') && sel.length) {
        e.preventDefault()
        const ids = new Set(sel.map((n) => n.id))
        // a cut pastes back where it was first
        clipboard = { nodes: sel, edges: (rf.getEdges() as FEdge[]).filter((x) => ids.has(x.source) && ids.has(x.target)), pasted: key === 'x' ? -1 : 0 }
        if (key === 'x') rf.deleteElements({ nodes: sel })
      } else if (key === 'v' && clipboard) {
        e.preventDefault()
        const c = clipboard, d = 24 * ++c.pasted
        const ids = new Map(c.nodes.map((n) => [n.id, crypto.randomUUID().slice(0, 8)]))
        rf.setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...c.nodes.map((n): FNode => ({
          id: ids.get(n.id)!, type: 'shape', position: { x: n.position.x + d, y: n.position.y + d }, width: dims(n).w, height: dims(n).h,
          zIndex: n.zIndex, data: { ...n.data, editing: undefined }, selected: true,
        }))])
        rf.setEdges((es) => [...es.map((x) => ({ ...x, selected: false })), ...c.edges.map((x) => ({
          ...x, id: `e-${crypto.randomUUID().slice(0, 8)}`, source: ids.get(x.source)!, target: ids.get(x.target)!, selected: true,
        }))])
      } else if (e.key === 'Tab' && sel.length === 1) {
        e.preventDefault()
        spawn(sel[0].id)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [rf, spawn])
  // layers: the selected go above (or under) all the rest, keeping their own order
  const layer = (front: boolean) => setNodes((ns) => {
    const zs = ns.filter((n) => !n.selected).map((n) => n.zIndex ?? 0)
    const z = front ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1
    return ns.map((n) => (n.selected ? { ...n, zIndex: z } : n))
  })
  const fill = (f: string) => setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, fill: f || undefined } } : n)))
  const toggle = (key: 'accent' | 'dashed') => {
    if (key === 'accent') setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, accent: !n.data.accent } } : n)))
    setEdges((es) => es.map((e) => (e.selected ? { ...e, ...edgeLook({ ...e.data, [key]: !e.data?.[key] }) } : e)))
  }
  const save = async () => {
    setBusy(true)
    try { await onSave(fromFlow(kind, nodes, edges), await exportPng(nodes).catch(() => null)) } finally { setBusy(false) }
  }

  return (
    <div className="sd-modal">
      <div className="sd-toolbar">
        <span className="eyebrow">{KINDS[kind].title}</span>
        {!catalog && KINDS[kind].shapes.map((s) => <button key={s} onClick={() => add(s)}>+ {s}</button>)}
        {!catalog && <span className="sep" />}
        <button onClick={() => toggle('accent')} title="Highlight selected nodes/edges">Accent</button>
        <button onClick={() => toggle('dashed')} title="Dashed selected edges">Dashed</button>
        <button onClick={editLabel} title="Label the selected arrow (or double-click it)">Label</button>
        <button onClick={straighten} title="Line up selected nodes, or the ends of selected arrows, so arrows run straight">Straighten</button>
        <button onClick={() => layer(true)} title="Bring the selected to the front">Front</button>
        <button onClick={() => layer(false)} title="Send the selected to the back">Back</button>
        <span className="sd-fills" role="group" aria-label="Fill">
          {['', ...Object.keys(FILLS)].map((f) => <button key={f} style={f ? { background: FILLS[f] } : undefined} title={f ? `Fill the selected: ${f}` : 'No fill'}
            aria-label={f ? `Fill ${f}` : 'No fill'} onClick={() => fill(f)} />)}
        </span>
        {catalog
          ? <span className="hint">drag components from the left · dbl-click to edit its text (<b>*</b> marks the current item) · <b>Accent</b>: primary, checked, on · <b>Front</b> / <b>Back</b>: layers · drag a dot: arrow · drag an edge or corner: resize · <kbd>⌘C</kbd> / <kbd>⌘V</kbd> copy, paste · <kbd>Del</kbd> delete</span>
          : <span className="hint">
            dbl-click canvas <b>+{KINDS[kind].def}</b> · <kbd>Tab</kbd> / click dot: add connected · dbl-click edit · drag select · <kbd>Space</kbd>+drag pan · <kbd>⌘C</kbd> / <kbd>⌘V</kbd> copy, paste · <kbd>Del</kbd> delete
          </span>}
        <span className="grow" />
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      <div className="sd-body">
      {catalog && <Catalog onAdd={add} />}
      <Spawn.Provider value={spawn}>
      <ReactFlow
        nodes={nodes} edges={edges} onNodesChange={onChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
        onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
        onDrop={(e) => {
          const shape = e.dataTransfer.getData(DRAG)
          if (!Object.hasOwn(SIZE, shape)) return
          e.preventDefault()
          addAt(shape, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
        }}
        nodeTypes={nodeTypes} edgeTypes={edgeTypes} connectionMode={ConnectionMode.Loose} elevateNodesOnSelect={false}
        onEdgeDoubleClick={(_, e) => setEdges((es) => es.map((x) => (x.id === e.id ? { ...x, data: { ...x.data, editing: true } } : x)))}
        onDoubleClick={(e) => {
          const t = e.target as Element
          const onCanvas = t.classList.contains('react-flow__pane') || (t.closest('.sd-zone, .sd-lane') && !t.closest('.sd-label'))
          if (onCanvas) addAt(KINDS[kind].def, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
        }}
        zoomOnDoubleClick={false} connectOnClick={false} selectionOnDrag panOnDrag={[1, 2]} panOnScroll selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        snapToGrid snapGrid={[8, 8]} deleteKeyCode={['Backspace', 'Delete']} fitView={init.nodes.length > 0} fitViewOptions={{ maxZoom: 1.2 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
        <Controls showInteractive={false} />
        <ViewportPortal><svg className="sd-guides" aria-hidden>{guides.map((g, i) => <line key={i} {...g} />)}</svg></ViewportPortal>
      </ReactFlow>
      </Spawn.Provider>
      </div>
    </div>
  )
}

// Read mode: the whole screen, drag to pan, scroll or pinch to zoom, Esc closes. onNodeClick: mind maps open a node.
type ViewProps = { value: Diagram; onNodeClick?: (id: string) => void }
const FILL = { maxZoom: 2, padding: 0.05 }
const clicks = (on?: (id: string) => void) => (on ? { className: 'clickable', onNodeClick: (_: unknown, n: { id: string }) => on(n.id) } : {})
export function DiagramViewer({ value, onClose, onNodeClick, title }: ViewProps & { onClose: () => void; title?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  // the flow mounts once the dialog is open: measured inside a closed (display: none) dialog, it fits a 0×0 pane
  const [open, setOpen] = useState(false)
  useEffect(() => { ref.current?.showModal(); setOpen(true) }, [])
  const { nodes, edges } = useMemo(() => toFlow(layout(value)), [value])
  return (
    <dialog ref={ref} className="sd-modal" aria-label="Diagram" onCancel={(e) => { e.preventDefault(); onClose() }}>
      <div className="sd-toolbar">
        <span className="eyebrow">{title ?? KINDS[value.kind]?.title ?? 'Diagram'}</span>
        <span className="hint">drag to pan · scroll or pinch to zoom · <kbd>Esc</kbd> closes</span>
        <span className="grow" />
        <button onClick={onClose}>Close</button>
      </div>
      {open && <ReadOnly.Provider value={true}>
        <ReactFlowProvider>
          {/* fills the screen: a small diagram grows up to 2x, a big one shrinks to fit */}
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} connectionMode={ConnectionMode.Loose}
            fitView fitViewOptions={FILL} minZoom={0.1} maxZoom={4} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
            zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }} {...clicks(onNodeClick)}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
            <Controls showInteractive={false} fitViewOptions={FILL} />
          </ReactFlow>
        </ReactFlowProvider>
      </ReadOnly.Provider>}
    </dialog>
  )
}

export function DiagramView({ value, onNodeClick }: ViewProps) {
  const { nodes, edges } = useMemo(() => toFlow(layout(value)), [value])
  const b = getNodesBounds(nodes)
  const height = Math.max(160, Math.min(520, b.height + 80))
  return (
    <ReadOnly.Provider value={true}>
      <div className="sd-view" style={{ height }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} connectionMode={ConnectionMode.Loose}
            fitView fitViewOptions={{ maxZoom: 1 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
            panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} preventScrolling={false}
            {...clicks(onNodeClick)}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </ReadOnly.Provider>
  )
}
