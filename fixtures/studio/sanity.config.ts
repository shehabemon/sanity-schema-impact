import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { schemaTypes } from './schemaTypes';

const projectId = process.env.SANITY_STUDIO_PROJECT_ID ?? 'fixtureprojectid';
const dataset = process.env.SANITY_STUDIO_DATASET ?? 'fixture';

export default defineConfig({
  name: 'default',
  title: 'Schema impact fixture',
  projectId,
  dataset,
  plugins: [structureTool()],
  schema: {
    types: schemaTypes,
  },
});
