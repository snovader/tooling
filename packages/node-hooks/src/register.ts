// Registers the TypeScript load hook, for `node --import @snovader/node-hooks/register`
import { registerHooks } from 'node:module';
import { load } from './typescript.ts';

registerHooks({ load });
