import { defineCliConfig } from 'sanity/cli';

const projectId = process.env.SANITY_STUDIO_PROJECT_ID ?? 'fixtureprojectid';
const dataset = process.env.SANITY_STUDIO_DATASET ?? 'fixture';

export default defineCliConfig({
  api: {
    projectId,
    dataset,
  },
});
