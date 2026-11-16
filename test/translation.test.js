import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationHandler } from '../api/translate.js';
const request = () => new Request('http://localhost/api/translate', {method:'POST', body: JSON.stringify({texts:['Hello','Goodbye'],targetLanguage:'Spanish'})});
test('translation preserves ordering and falls back only on quota failures', async () => {
  const calls=[];
  const handler=createTranslationHandler({env:{GEMINI_API_KEY:'test',GEMINI_MODEL:'first',GEMINI_MODELS:'second'},generateText:async (input,env,model)=>{
    calls.push(model); assert.deepEqual(input.texts,['Hello','Goodbye']);
    if(model==='first') throw Object.assign(new Error('quota'),{status:429});
    return JSON.stringify({translations:['Hola','Adiós']});
  }});
  assert.deepEqual(await (await handler(request())).json(),{translations:['Hola','Adiós']});
  await handler(request()); assert.deepEqual(calls,['first','second','second']);
});
test('translation rejects missing translations and clearly declines mock translation',async()=>{
  const handler=createTranslationHandler({env:{GEMINI_API_KEY:'test'},generateText:async()=>JSON.stringify({translations:['Hola']})});
  assert.equal((await handler(request())).status,502);
  assert.equal((await createTranslationHandler({env:{MEETING_MOCK:'true'}})(request())).status,503);
});
