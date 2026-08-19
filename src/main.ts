import './helpers/string-colors.js';
// import { toolUseMain } from './patterns/01-tool-use/tool-use.js';
// import { planningMain } from './patterns/02-planning/planning.js';
// import { getMessageFromModel } from './actions/get-message-model.js';
// import { reflectionMain } from './patterns/03-reflection/reflection.js';
import { reActSimpleMain } from './patterns/04-reAct/reAct-loop.js';

console.clear();

// await getMessageFromModel();

// await toolUseMain();
// await planningMain();
// await reflectionMain();
await reActSimpleMain();
