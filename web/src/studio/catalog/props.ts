// Prop models for the asset library. scripts/props.ts downloads each GLB from Poly Pizza to public/studio/props/<id>.glb
// and records the title, author and license in props.credits.json (all CC0; see CREDITS.md).
// Game-asset scales are arbitrary, so every prop is scaled at load time to a real-world size: `fit` names the
// dimension (height, or length = the longer horizontal side) and its typical value in metres.

export type PropCategory = 'Vehicles' | 'Street' | 'Furniture' | 'Plants' | 'Signs';

export interface PropSpec {
  id: string;
  name: string;
  category: PropCategory;
  polyPizza: string; // model id on poly.pizza
  fit: ['height' | 'length', number];
}

export const PROPS: PropSpec[] = [
  { id: 'car', name: 'Car (sedan)', category: 'Vehicles', polyPizza: 'Cz6yDaUcM9', fit: ['length', 4.6] },
  { id: 'taxi', name: 'Taxi', category: 'Vehicles', polyPizza: 'x43lOScTpN', fit: ['length', 4.8] },
  { id: 'suv', name: 'SUV', category: 'Vehicles', polyPizza: 'xsMtZhBkxL', fit: ['length', 4.8] },
  { id: 'bike', name: 'Bicycle', category: 'Vehicles', polyPizza: 'NHjJnFYYCc', fit: ['length', 1.75] },
  { id: 'bench', name: 'Park bench', category: 'Furniture', polyPizza: 'jLxjFxFRpw', fit: ['length', 1.8] },
  { id: 'chair', name: 'Chair', category: 'Furniture', polyPizza: 'iMNqRzPwwe', fit: ['height', 0.9] },
  { id: 'table', name: 'Small table', category: 'Furniture', polyPizza: 'rAEBvfb1FT', fit: ['height', 0.75] },
  { id: 'parasol', name: 'Parasol', category: 'Furniture', polyPizza: 'FLEbO2jluO', fit: ['height', 2.4] },
  { id: 'flowers', name: 'Flowers', category: 'Plants', polyPizza: 'NBUxHir6FJ', fit: ['height', 0.4] },
  { id: 'potted-plant', name: 'Potted plant', category: 'Plants', polyPizza: '23Dx9CC95C', fit: ['height', 0.9] },
  { id: 'streetlight', name: 'Street light', category: 'Street', polyPizza: 'Bq1Qj4DAre', fit: ['height', 6] },
  { id: 'traffic-light', name: 'Traffic light', category: 'Street', polyPizza: 'apWcPbwhlq', fit: ['height', 4.5] },
  { id: 'cone', name: 'Traffic cone', category: 'Street', polyPizza: 'aDIrUbMbW3', fit: ['height', 0.7] },
  { id: 'hydrant', name: 'Fire hydrant', category: 'Street', polyPizza: 'DKkMQbEklp', fit: ['height', 0.75] },
  { id: 'trash-can', name: 'Trash can', category: 'Street', polyPizza: 'vlVx279xut', fit: ['height', 1.0] },
  { id: 'town-sign', name: 'Town sign', category: 'Signs', polyPizza: 'VSZubp0ru3', fit: ['height', 2.5] },
  { id: 'arrow-sign', name: 'Arrow sign', category: 'Signs', polyPizza: 'dwmvPHHCdq', fit: ['height', 1.5] },
];

export const propById = (id: string) => PROPS.find(p => p.id === id);
