// Fake AI output for building the mind map before the real AI sends parentId.
// Same shape as the team's meeting state (nodes, edges, actionItems), plus parentId:
//   no parentId            -> main idea
//   parentId = main idea   -> main point
//   parentId = main point  -> detail
// Based on the "CS Group Project Planning" sample transcript.

const node = (id, label, summary, importance, parentId) => ({ id, label, summary, importance, parentId });

export const mockMeeting = {
  nodes: [
    // Main idea
    node('project', 'Hackathon Project Plan', 'Build a tool that turns meeting audio into a mind map and a to-do list.', 5, null),

    // Main points
    node('stack', 'Tech Stack', 'React frontend. OpenAI for both speech-to-text and structuring: one API, two calls.', 4, 'project'),
    node('data', 'JSON Structure', 'Transcript JSON and AI output JSON are two separate structures.', 4, 'project'),
    node('roles', 'Team Roles', 'Each person owns one piece of the pipeline.', 4, 'project'),
    node('timeline', 'Timeline', 'Working demo by noon Saturday, even if it is ugly.', 4, 'project'),
    node('errors', 'Bad AI Output', 'Validate the JSON and retry with a stricter prompt.', 3, 'project'),
    node('demo', 'Demo Transcript', 'Fake transcript for development, real recording for the demo.', 3, 'project'),
    node('quiz', 'Quiz Study Plan', 'Study for Tuesday\'s quiz on Sunday evening.', 1, 'project'),

    // Details: Tech Stack
    node('stack-react', 'React frontend', 'Everyone agreed React makes the most sense.', 2, 'stack'),
    node('stack-openai', 'OpenAI Whisper + GPT', 'Whisper for speech-to-text, GPT for structuring.', 3, 'stack'),
    node('stack-flow', 'React Flow + dagre', 'dagre auto-arranges nodes in a tree.', 2, 'stack'),

    // Details: JSON Structure
    node('data-transcript', 'Transcript: time, speaker, text', 'What comes out of speech-to-text.', 2, 'data'),
    node('data-output', 'AI output: nodes, edges, tasks', 'What the mind map reads.', 3, 'data'),
    node('data-speaker', 'Speaker attribution', 'Track who said what.', 2, 'data'),

    // Details: Team Roles
    node('roles-rikki', 'Rikki: mind map', 'Turns AI output into the visual map.', 2, 'roles'),
    node('roles-david', 'David: backend API', 'Whisper and GPT calls, validation.', 2, 'roles'),
    node('roles-micah', 'Micah: recording + repo', 'Recording interface and GitHub setup.', 2, 'roles'),
    node('roles-sophia', 'Sophia: summary + to-do', 'Summary and to-do list screen.', 2, 'roles'),

    // Details: Timeline
    node('time-repo', 'Repo tonight', 'Micah adds everyone as collaborators.', 2, 'timeline'),
    node('time-pipeline', 'Pipeline tomorrow AM', 'Audio in, mind map out.', 3, 'timeline'),
    node('time-demo', 'Demo by noon Sat', 'Working end to end.', 3, 'timeline'),
    node('time-slack', 'Slack check-in 10 PM', 'Everyone reports progress.', 1, 'timeline'),

    // Details: Bad AI Output
    node('err-validate', 'Validate JSON schema', 'Check the shape on the backend.', 2, 'errors'),
    node('err-retry', 'Max 2 retries', 'Protect API credits.', 2, 'errors'),
    node('err-message', 'Then show an error', 'User can try again.', 1, 'errors'),

    // Details: Demo Transcript
    node('demo-fake', 'Fake one for dev', 'So nobody is blocked waiting on a recording.', 2, 'demo'),
    node('demo-real', 'Record a real one', 'Used for the final demo.', 2, 'demo'),

    // Details: Quiz Study Plan
    node('quiz-sunday', 'Sunday evening', 'After the hackathon.', 1, 'quiz'),
  ],
  edges: [],
  actionItems: [
    { id: 'task-repo', text: 'Micah will set up the GitHub repo and add everyone tonight.' },
    { id: 'task-backend', text: 'David will build the backend pipeline and schema validator tomorrow morning.' },
    { id: 'task-fake', text: 'Micah will write a fake transcript tonight.' },
    { id: 'task-slack', text: 'Everyone checks in on Slack by 10 PM tonight.' },
  ],
};

// One edge for every parent -> child link, in the team's edge shape { id, source, target }.
mockMeeting.edges = mockMeeting.nodes
  .filter(n => n.parentId)
  .map(n => ({ id: `${n.parentId}-${n.id}`, source: n.parentId, target: n.id }));
