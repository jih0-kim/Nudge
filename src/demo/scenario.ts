/** Entirely fictional, deliberately fixed in time so rehearsals are repeatable. */
export const demoScenario = {
  id: 'maya-interview-day-v1',
  date: '2026-10-22',
  dateLabel: 'Thursday, October 22',
  time: '10:20',
  timezone: 'America/New_York',
  persona: {
    name: 'Maya Chen',
    email: 'maya.chen@example.test',
    role: 'Product designer at Sprout',
    goal: 'Build a daily customer-research habit without burning out.',
  },
  emails: [
    {
      id: 'interview', from: 'Leah Park', address: 'leah@example.test', initials: 'LP', color: '#e4eafa',
      subject: 'Before our 11:00 customer interview', time: '10:12 AM', unread: true, label: 'Research',
      preview: 'Could you bring three questions about the onboarding drop-off?',
      body: 'Hey Maya,\n\nLooking forward to our customer interview at 11:00. Could you bring three open-ended questions about where people get stuck during onboarding?\n\nNo polished deck needed. Even one good question is a useful start. We’ll compare notes in the call.\n\nThanks!\nLeah',
    },
    {
      id: 'launch', from: 'Jordan Ellis', address: 'jordan@example.test', initials: 'JE', color: '#fce6d7',
      subject: 'Launch checklist — review by Friday', time: '9:48 AM', unread: true, label: 'Team',
      preview: 'Not urgent today. Please review the empty-state copy before Friday afternoon.',
      body: 'Hi team,\n\nThe launch checklist is ready. Maya, please review the empty-state copy before Friday at 3 PM. This is not urgent today; customer research comes first.\n\nWe can review your notes asynchronously. No extra meeting needed.\n\nJordan',
    },
    {
      id: 'newsletter', from: 'Design Weekly', address: 'digest@example.test', initials: 'DW', color: '#e9e1fb',
      subject: '24 onboarding patterns worth bookmarking', time: '9:15 AM', unread: false, label: 'Reading',
      preview: 'Your weekly inspiration, to read whenever you have a quiet moment.',
      body: 'This week: onboarding patterns, research templates, and thoughtful empty states.\n\nSave this for a quiet moment. There is no action or deadline attached to this fictional newsletter.\n\nThe Design Weekly team',
    },
    {
      id: 'walk', from: 'Sam Rivera', address: 'sam@example.test', initials: 'SR', color: '#dceee5',
      subject: 'Lunch walk? No screens allowed 🌿', time: '8:52 AM', unread: false, label: 'Personal',
      preview: 'I saved 12:30 for a short walk. Let’s actually take a break today.',
      body: 'Morning Maya!\n\nI saved 12:30 for a short walk around the block. Let’s actually take a break today. You said you wanted to get away from your desk at lunch, so this is your friendly reminder.\n\nSam',
    },
    {
      id: 'notes', from: 'Maya Chen', address: 'maya.chen@example.test', initials: 'MC', color: '#faefce',
      subject: 'Note to self: small counts', time: 'Yesterday', unread: false, label: 'Personal',
      preview: 'I keep skipping research because I think I need an uninterrupted hour.',
      body: 'I keep skipping research because I think I need an uninterrupted hour.\n\nExperiment for this week: do one tiny piece every day. One question, one observation, one note.\n\nPlease don’t turn lunch into another work block.\n\n— Maya',
    },
  ],
  events: [
    { id: 'standup', title: 'Team standup', start: '09:30', end: '10:00', kind: 'team', detail: 'Daily check-in · finished' },
    { id: 'review', title: 'Design review', start: '10:00', end: '10:20', kind: 'team', detail: 'Onboarding flow · just finished' },
    { id: 'interview', title: 'Customer interview', start: '11:00', end: '11:45', kind: 'research', detail: 'With Leah · bring three questions' },
    { id: 'debrief', title: 'Capture interview notes', start: '11:45', end: '12:00', kind: 'focus', detail: 'One observation is enough' },
    { id: 'lunch', title: 'Lunch + a walk with Sam', start: '12:30', end: '13:15', kind: 'personal', detail: 'Protected break · no screens' },
    { id: 'focus', title: 'Focus time: onboarding', start: '13:30', end: '15:00', kind: 'focus', detail: 'Async work · notifications off' },
    { id: 'sync', title: 'Product sync', start: '15:00', end: '15:30', kind: 'team', detail: 'Launch planning' },
  ],
};

/** Arrives over real elapsed time; all names, addresses, and messages are fictional. */
export const incomingDemoEmails = [
  {
    id: 'incoming-interview-update', from: 'Leah Park', address: 'leah@example.test', initials: 'LP', color: '#e4eafa',
    subject: 'Interview update: one good question is enough', time: '10:20 AM', unread: true, label: 'New · Research',
    preview: 'The customer has less time today. Bring just one question about inviting a teammate.',
    body: 'Hey Maya,\n\nA quick update before our 11:00 interview: the customer has less time today. Instead of three questions, bring just one open-ended question about inviting a teammate during onboarding.\n\nWriting a rough question in your notes is enough. No slide deck and no email reply needed.\n\nLeah',
  },
  {
    id: 'incoming-customer-clue', from: 'Alex Morgan', address: 'alex@example.test', initials: 'AM', color: '#dceee5',
    subject: 'A detail for the interview: I could not find Invite', time: '10:20 AM', unread: true, label: 'New · Customer',
    preview: 'I looked in Settings, but the Invite button was on the workspace home screen.',
    body: 'Hi Maya,\n\nOne detail for our interview: I tried inviting a teammate yesterday. I looked in Settings for a few minutes, but later discovered Invite was on the workspace home screen. I was not sure whether I needed admin permissions.\n\nNo need to solve it before the call. You could note one follow-up question about what I expected to see.\n\nAlex',
  },
  {
    id: 'incoming-priority-change', from: 'Jordan Ellis', address: 'jordan@example.test', initials: 'JE', color: '#fce6d7',
    subject: 'Priority update: the launch review can wait', time: '10:20 AM', unread: true, label: 'New · Team',
    preview: 'Keep your interview prep tiny and your lunch walk protected.',
    body: 'Hey Maya,\n\nThe launch copy review has moved to next week. Please do not work through lunch to get ahead. One tiny interview-prep step is plenty for now.\n\nIf you already wrote your question, jot down one thing you want to learn from Alex and then take a break.\n\nJordan',
  },
];
