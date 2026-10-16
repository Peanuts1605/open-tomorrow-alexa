// Entirely fictional fixture. Minutes are local wall time on one explicitly named day.
export const florist = {
  title: 'One Saturday away — fictional flower shop', date: '2026-09-19',
  people: [
    { id: 'opener', label: 'Helper A', available: [{ start: 480, end: 720 }] },
    { id: 'driver', label: 'Helper B', available: [{ start: 480, end: 720 }] },
    { id: 'spare', label: 'Helper C', available: [{ start: 480, end: 720 }] }
  ],
  tasks: [
    { id: 'setup', label: 'Set up the shop', start: 480, end: 540, assignee: 'opener' },
    { id: 'delivery', label: 'Deliver the morning flowers', start: 510, end: 555, assignee: 'opener' }
  ]
};
