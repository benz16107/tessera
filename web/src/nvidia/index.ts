// NVIDIA panels for the studio (mounted through studio/slots.tsx NvidiaSlot). Each talks to the crew's endpoints and reads
// Nemotron's live steps from the agent_step table. Themable: override the --nv-* variables in nvidia.css.
import './nvidia.css';
export { CommandBar } from './CommandBar.tsx';
export { PropGenerator } from './PropGenerator.tsx';
export { RenderPanel, postLayers, type Layers } from './RenderPanel.tsx';
export { ArtDirector } from './ArtDirector.tsx';
export { PoweredBy, PoweredBy as PoweredByNvidia } from './PoweredBy.tsx';
export { CallSheet } from './CallSheet.tsx';
export { useAgentSteps } from './api.ts';
