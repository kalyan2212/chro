// User-selected images only. Never fetch arbitrary URLs or persist attachments.
const fail = message => Object.assign(new Error(message), {status:400});
export function validateImage(input) {
 if(input==null)return undefined;
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.dataUrl!=='string')throw fail('Attach a PNG or JPEG image.');
 const match=input.dataUrl.match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/);
 if(!match||match[2].length>6_000_000)throw fail('Attach a PNG or JPEG image smaller than 4 MB.');
 const bytes=Buffer.from(match[2],'base64');
 if(bytes.length<16||bytes.length>4_000_000||bytes.toString('base64')!==match[2])throw fail('The image encoding is invalid or too large.');
 const valid=match[1]==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!valid)throw fail('The attachment does not match its image type.');
 return {dataUrl:input.dataUrl,mimeType:match[1],name:typeof input.name==='string'?input.name.replace(/[\u0000-\u001f<>]/g,'').slice(0,120):'Attached chart'};
}
