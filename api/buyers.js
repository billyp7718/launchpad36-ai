export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'APOLLO_API_KEY is not configured in Vercel.' });
  const domain = String(req.query.domain || '').trim().toLowerCase();
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return res.status(400).json({ error: 'Invalid retailer domain.' });
  const titles = ['buyer','senior buyer','merchant','senior merchant','category manager','category merchant','director merchandising','director of merchandising','divisional merchandise manager','merchandise manager'];
  try {
    const response = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
      method:'POST', headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Api-Key':apiKey},
      body: JSON.stringify({q_organization_domains_list:[domain],person_titles:titles,include_similar_titles:true,person_seniorities:['manager','director','vp'],per_page:12,page:1})
    });
    const raw = await response.json();
    if (!response.ok) return res.status(response.status).json({error:raw.message || raw.error || 'Apollo request failed'});
    const people=(raw.people||[]).map(p=>({id:p.id,name:[p.first_name,p.last_name].filter(Boolean).join(' ')||p.name||'Apollo profile',title:p.title,organization:p.organization?.name,location:[p.city,p.state,p.country].filter(Boolean).join(', '),linkedin_url:p.linkedin_url,masked:!!p.last_name_obfuscated}));
    res.setHeader('Cache-Control','no-store'); return res.status(200).json({people});
  } catch (e) { return res.status(500).json({error:'Unable to reach Apollo.'}); }
}
