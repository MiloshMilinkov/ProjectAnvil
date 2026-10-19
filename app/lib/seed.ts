import type { Canvas, Note, Task, Workspace } from './types';

// Relative demo dates keep the starting dashboard useful whenever a vault is created.
export function createSeedWorkspace(now = new Date()): Workspace {
  const iso = now.toISOString();
  const day = (offset: number) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const note = (id: string, title: string, content: string, extra: Partial<Note> = {}): Note => ({
    id, title, content, folder: 'Aetherfall', tags: [], projectId: 'aetherfall', kind: 'note',
    bookmarked: false, properties: {}, snapshots: [], createdAt: iso, updatedAt: iso, ...extra,
  });
  const task = (number: number, title: string, extra: Partial<Task> = {}): Task => ({
    id: `task-${number}`, key: `AET-${String(number).padStart(3, '0')}`, title,
    description: '', status: 'todo', priority: 'medium', type: 'task', projectId: 'aetherfall',
    assigneeId: '', dueDate: '', estimate: 2, tags: [], noteIds: [], blockedBy: [], subtasks: [],
    comments: [], createdAt: iso, updatedAt: iso, ...extra,
  });
  const canvas: Canvas = {
    id: 'canvas-world', title: 'Aetherfall · the first expedition',
    cards: [
      { id: 'card-vision', x: 70, y: 75, width: 290, height: 205, type: 'note', entityId: 'note-vision', text: 'Aetherfall', color: '#8a78fa' },
      { id: 'card-city', x: 450, y: 35, width: 290, height: 210, type: 'note', entityId: 'note-city', text: 'The Sunken City', color: '#54b5cc' },
      { id: 'card-mira', x: 450, y: 330, width: 290, height: 200, type: 'note', entityId: 'note-mira', text: 'Mira Voss', color: '#e8ad70' },
      { id: 'card-gate', x: 830, y: 115, width: 280, height: 205, type: 'task', entityId: 'task-1', text: 'Prototype the resonance gate', color: '#8a78fa' },
      { id: 'card-question', x: 825, y: 405, width: 285, height: 175, type: 'text', text: 'What if the city remembers the player?\n\nTry environmental changes after each memory is recovered.', color: '#63c9a0' },
    ],
    edges: [
      { id: 'edge-1', from: 'card-vision', to: 'card-city', label: 'explore' },
      { id: 'edge-2', from: 'card-city', to: 'card-gate', label: 'first playable' },
      { id: 'edge-3', from: 'card-vision', to: 'card-mira', label: 'follow' },
      { id: 'edge-4', from: 'card-mira', to: 'card-question', label: 'motivation' },
      { id: 'edge-5', from: 'card-question', to: 'card-city', label: 'world reaction' },
    ],
  };
  return {
    name: 'Emberlight Studio', revision: 0,
    people: [
      { id: 'person-alex', name: 'Alex Morgan', role: 'Game director', color: '#8a78fa' },
      { id: 'person-jamie', name: 'Jamie Chen', role: 'Gameplay engineer', color: '#54b5cc' },
      { id: 'person-sam', name: 'Sam Rivera', role: 'Environment artist', color: '#e8ad70' },
      { id: 'person-robin', name: 'Robin Ellis', role: 'Narrative designer', color: '#63c9a0' },
    ],
    projects: [
      { id: 'aetherfall', name: 'Aetherfall', key: 'AET', description: 'An atmospheric exploration game about a city that remembers.', color: '#8a78fa', status: 'In development', goal: 'A 15-minute vertical slice: one district, one memory, one meaningful choice.', targetDate: day(42) },
      { id: 'moonjam', name: 'Moonlit Market', key: 'MM', description: 'A cozy weekend prototype about running a night market for wandering spirits.', color: '#e8ad70', status: 'Exploration', goal: 'Find the fun in a five-minute trading loop.', targetDate: day(16) },
    ],
    tasks: [
      task(1, 'Prototype the resonance gate', { status: 'in-progress', priority: 'high', assigneeId: 'person-jamie', dueDate: day(1), estimate: 5, tags: ['gameplay', 'vertical-slice'], noteIds: ['note-mechanics', 'note-city'], description: 'Build the first resonance interaction described in [[Resonance Mechanics]]. Hold a note, align the waveform, and open the way into [[The Sunken City]].\n\nAcceptance: readable feedback, keyboard + controller support, and a reset when the player steps away.', subtasks: [{ id: 'sub-1a', title: 'Wire the resonance input', done: true }, { id: 'sub-1b', title: 'Add visual alignment feedback', done: false }, { id: 'sub-1c', title: 'Test controller dead zones', done: false }], comments: [{ id: 'comment-1', personId: 'person-alex', body: 'Keep this rough. We need to feel the interaction before polishing the gate.', createdAt: iso }] }),
      task(2, 'Block out the flooded observatory', { status: 'in-progress', priority: 'high', assigneeId: 'person-sam', dueDate: day(3), estimate: 8, tags: ['environment', 'vertical-slice'], noteIds: ['note-city'], description: 'Create a navigable greybox for the entrance district. Establish the observatory silhouette and the waterline. Follow [[The Sunken City#Landmarks]].' }),
      task(3, 'Write Mira’s first memory encounter', { status: 'review', priority: 'medium', type: 'story', assigneeId: 'person-robin', dueDate: day(0), estimate: 3, tags: ['narrative'], noteIds: ['note-mira', 'note-factions'], description: 'Draft a 90-second memory sequence that reveals why Mira returned. Leave room for the player to interpret the Archive’s motives.' }),
      task(4, 'Fix camera clipping under archways', { status: 'todo', priority: 'urgent', type: 'bug', assigneeId: 'person-jamie', dueDate: day(-1), estimate: 2, tags: ['camera', 'playtest'], description: 'The follow camera passes through the north arch during a fast turn. Repro: enter courtyard → hug the left wall → rotate clockwise.' }),
      task(5, 'Define the vertical slice success criteria', { status: 'done', priority: 'high', assigneeId: 'person-alex', dueDate: day(-2), estimate: 2, tags: ['planning'], noteIds: ['note-vision'], description: 'Agree on the experience we are testing and the evidence we need. Captured in [[Game Vision#The vertical slice]].' }),
      task(6, 'Design three readable resonance symbols', { status: 'todo', priority: 'medium', assigneeId: 'person-sam', dueDate: day(5), estimate: 3, tags: ['ui', 'art'], noteIds: ['note-mechanics'], description: 'Make symbols readable in monochrome at 24px. Shape should communicate each state without depending on color.' }),
      task(7, 'Run the first external playtest', { status: 'backlog', priority: 'high', assigneeId: 'person-alex', dueDate: day(10), estimate: 4, blockedBy: ['task-1', 'task-2', 'task-3'], tags: ['playtest'], noteIds: ['note-playtest'], description: 'Invite three fresh players. Watch silently, capture hesitation points, and ask what the city seems to want.' }),
      task(8, 'Sketch the Archive faction crest', { status: 'todo', priority: 'low', assigneeId: 'person-sam', dueDate: day(8), estimate: 2, tags: ['worldbuilding', 'art'], noteIds: ['note-factions'], description: 'Explore an incomplete circle and a thread of light. The crest should feel repaired, never pristine.' }),
      task(9, 'Explore memory fragments as collectibles', { status: 'backlog', priority: 'medium', type: 'epic', assigneeId: 'person-robin', estimate: 8, tags: ['worldbuilding', 'design'], noteIds: ['note-mechanics', 'note-mira'], description: 'Connect optional fragments to places and relationships. Avoid a checklist: each fragment should change the player’s understanding.' }),
      task(10, 'Implement a checkpoint at the city entrance', { status: 'todo', priority: 'medium', assigneeId: 'person-jamie', dueDate: day(6), estimate: 3, blockedBy: ['task-1'], tags: ['gameplay'], description: 'Persist the opened gate and recovered memory after a restart. Include a clear new-game reset.' }),
      task(11, 'Create the ambience palette', { status: 'review', priority: 'low', assigneeId: 'person-sam', dueDate: day(2), estimate: 3, tags: ['audio', 'mood'], noteIds: ['note-city'], description: 'Gather water, distant metal, and sparse harmonic tones. Reserve silence for entering a memory.' }),
      task(12, 'Document interaction accessibility', { status: 'done', priority: 'medium', assigneeId: 'person-alex', estimate: 2, tags: ['accessibility'], noteIds: ['note-mechanics'], description: 'Document hold/toggle options, shape-based feedback, and reduced-motion behavior.' }),
      task(13, 'Prototype a spirit’s first trade', { key: 'MM-001', projectId: 'moonjam', status: 'in-progress', priority: 'medium', assigneeId: 'person-jamie', dueDate: day(7), estimate: 3, tags: ['prototype'], noteIds: ['note-market'], description: 'One visitor, two objects, and a trade that reveals a small story. Keep the interface to three choices.' }),
      task(14, 'Collect night-market visual references', { key: 'MM-002', projectId: 'moonjam', status: 'todo', priority: 'low', assigneeId: 'person-robin', dueDate: day(4), estimate: 1, tags: ['research'], noteIds: ['note-market'], description: 'Look for warm lanterns, silhouettes, and hand-painted signs. Record sources and what we learn from each reference.' }),
    ],
    notes: [
      note('note-vision', 'Game Vision', '# Aetherfall\n\nA city sank beneath the clouds. Its memories stayed behind.\n\n> Explore a place that remembers you before you remember it.\n\n## Pillars\n\n- **Curiosity over combat** — reward attention and experimentation.\n- **A world that responds** — memories change the places around you.\n- **Small, human stories** — the mystery matters because people do.\n\n## The vertical slice\n\nA 15-minute journey through [[The Sunken City]], guided by [[Mira Voss]]. One resonance gate, one recovered memory, one choice.\n\n- [x] Agree on the experience\n- [ ] Make the gate feel good\n- [ ] Watch three people play\n\n![[Resonance Mechanics#Core loop]]\n\nSee [[Playtest Plan]] for what we want to learn.', { bookmarked: true, tags: ['vision', 'vertical-slice'], properties: { Owner: 'Alex Morgan', Stage: 'Production' } }),
      note('note-city', 'The Sunken City', '# The Sunken City\n\nSuspended stone bridges cross an ocean of clouds. Water gathers in places where gravity has forgotten its direction.\n\n## Landmarks\n\n| Place | Purpose | Feeling |\n| --- | --- | --- |\n| Flooded observatory | Arrival and first gate | Awe |\n| Threadbridge | First memory | Fragility |\n| Archive steps | A choice about the past | Unease |\n\n## Environmental rules\n\nThe city repairs itself around recovered memories. A window returns. A light turns on. A name appears above a door. ^city-memory\n\n[[The Archive]] once kept this place alive. [[Mira Voss]] believes it can again.\n\n![[Game Vision#Pillars]]', { kind: 'world', folder: 'Aetherfall/World', tags: ['worldbuilding', 'environment'], bookmarked: true, properties: { Region: 'Upper district', Mood: 'Wonder / melancholy' } }),
      note('note-mira', 'Mira Voss', '# Mira Voss\n\n**Role:** cartographer, reluctant witness, playable character.\n\nMira draws maps of places that no longer exist. She has returned to [[The Sunken City]] with a page missing from her own notebook.\n\n## Wants and fears\n\n- Wants to find the person who left her a map.\n- Fears the city remembers something she chose to forget.\n- Trusts practical gestures more than explanations.\n\n## The first encounter\n\nA memory repeats beside the Threadbridge. Mira recognizes the tune before she recognizes the voice.\n\n> “I drew the way home. I just never drew the door.”\n\nRelated: [[The Archive]], [[Resonance Mechanics]].', { kind: 'character', folder: 'Aetherfall/Characters', tags: ['character', 'narrative'], properties: { Pronouns: 'she/her', Faction: 'Unaffiliated' } }),
      note('note-factions', 'The Archive', '# The Archive\n\nA collective of memory keepers who believed a city could survive as long as someone remembered it.\n\n## Open questions\n\n- Who decides which memories are worth saving?\n- What did they ask [[Mira Voss]] to give up?\n- Can a place forgive an institution?\n\n## Visual language\n\nMended paper, incomplete circles, gold thread. Their mark always has a gap.\n\n![[The Sunken City#^city-memory]]', { kind: 'world', folder: 'Aetherfall/World', tags: ['faction', 'worldbuilding'], properties: { Alignment: 'Complicated', Symbol: 'The open circle' } }),
      note('note-mechanics', 'Resonance Mechanics', '# Resonance Mechanics\n\n## Core loop\n\nListen → align → remember → change the world.\n\nThe player holds a tone and aligns it with a nearby resonance object. Feedback uses **shape, sound, and motion** together.\n\n```mermaid\nflowchart LR\n  Listen --> Align\n  Align --> Memory\n  Memory --> World[World changes]\n  World --> Listen\n```\n\n## Prototype notes\n\n```ts\nconst aligned = Math.abs(playerFrequency - targetFrequency) < tolerance;\n```\n\nResonance strength: $r = e^{-\\alpha |f_p - f_t|}$.\n\n## Accessibility\n\n- Hold or toggle input.\n- Never require color alone.\n- Reduced motion replaces pulses with a steady outline.\n\nThe first test happens in [[The Sunken City]]. It supports the curiosity pillar in [[Game Vision]].', { folder: 'Aetherfall/Design', tags: ['mechanics', 'technical'], properties: { Status: 'Prototyping' } }),
      note('note-playtest', 'Playtest Plan', '# First external playtest\n\n## What we want to learn\n\n1. Does the player notice the resonance gate?\n2. Can they explain what changed after the memory?\n3. Do they want to explore one more place?\n\n## Session\n\n- 15 minutes of play, no hints unless the player is stuck for two minutes.\n- Note timestamp, observed behavior, and their exact words.\n- Ask “What do you think happened?” before explaining.\n\n## Observation template\n\n| Time | Observation | Follow-up |\n| --- | --- | --- |\n| | | |\n\nReference: [[Game Vision]], [[Resonance Mechanics]].', { kind: 'research', folder: 'Aetherfall/Research', tags: ['playtest', 'template'] }),
      note('note-daily', `${day(0)} · Studio journal`, `# Studio journal · ${day(0)}\n\n## Today’s focus\n\nGet the first five minutes of [[Game Vision]] into someone’s hands.\n\n- [ ] Check the resonance gate with Jamie\n- [ ] Review the observatory blockout\n- [ ] Read the first [[Mira Voss]] encounter\n\n## Scratchpad\n\nWhat if the city’s lights follow the order in which memories are recovered?\n\n## End of day\n\nWhat moved forward? What is the smallest useful next step?`, { kind: 'daily', folder: 'Journal', tags: ['daily'], properties: { Date: day(0) } }),
      note('note-market', 'Moonlit Market', '# Moonlit Market\n\nA tiny game about trading ordinary objects with spirits who value them for extraordinary reasons.\n\n## First loop\n\nOpen your stall → meet a visitor → learn what they miss → make a trade.\n\n## Constraints\n\n- One small square\n- Three visitors\n- No currency: value is personal\n\n## First visitor\n\nA lighthouse keeper who wants a jar of summer rain. They offer a star that has forgotten where it belongs.', { projectId: 'moonjam', folder: 'Moonlit Market', tags: ['prototype', 'game-jam'], bookmarked: true }),
    ],
    media: [], canvases: [canvas],
    savedViews: [
      { id: 'view-slice', name: 'Vertical slice', query: 'vertical-slice', assignee: '', priority: '', project: 'aetherfall', status: '' },
      { id: 'view-review', name: 'Ready for review', query: '', assignee: '', priority: '', project: '', status: 'review' },
    ],
  };
}
