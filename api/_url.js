export function normalizePublicUrl(value=''){
  let input=String(value||'').trim();if(!input)return '';
  if(input.startsWith('//'))input=`https:${input}`;else if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(input))input=`https://${input}`;
  try{const url=new URL(input);if(!['http:','https:'].includes(url.protocol)||!url.hostname.includes('.'))return '';url.hash='';return url.toString()}catch{return ''}
}

export function domainFromWebsite(value=''){
  const url=normalizePublicUrl(value);if(!url)return '';
  return new URL(url).hostname.replace(/^www\./i,'').toLowerCase();
}
