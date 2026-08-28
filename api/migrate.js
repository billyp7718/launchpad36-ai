import { db, upsertAccount, upsertBuyer } from './_db.js';

function authorize(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return { ok: false, status: 503, error: 'ADMIN_SECRET is not configured' };
  if ((req.headers.authorization || '') !== `Bearer ${secret}`) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = authorize(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const sql = db();
    const { accounts = [], buyers = [], products = [] } = req.body || {};
    const accountMap = new Map();

    for (const a of accounts) {
      const row = await upsertAccount(a);
      accountMap.set(String(a.name || '').toLowerCase(), row.id);
    }

    for (const b of buyers) {
      let aid = b.account_id || accountMap.get(String(b.accountName || b.account || '').toLowerCase());
      if (!aid && (b.accountName || b.account)) {
        const row = await upsertAccount({
          name: b.accountName || b.account,
          type: 'Regional Retailer',
          source: 'migration'
        });
        aid = row.id;
        accountMap.set(String(row.name).toLowerCase(), aid);
      }
      if (aid) await upsertBuyer({ ...b, account_id: aid });
    }

    for (const p of products) {
      const prod = (await sql`
        insert into products(name,category,positioning,differentiator)
        values(${p.name || ''},${p.category || ''},${p.position || p.positioning || ''},${p.diff || p.differentiator || ''})
        returning *
      `)[0];

      for (const v of (p.variants || [])) {
        await sql`
          insert into product_variants(product_id,sku,variant_name,msrp,map,wholesale)
          values(${prod.id},${v.sku || ''},${v.name || ''},${Number(v.msrp) || 0},${Number(v.map) || 0},${Number(v.wholesale) || 0})
          on conflict do nothing
        `;
      }
    }

    return res.status(200).json({
      migrated: true,
      accounts: accounts.length,
      buyers: buyers.length,
      products: products.length
    });
  } catch (error) {
    console.error('Migration failed:', error);
    return res.status(500).json({ migrated: false, error: 'Migration failed' });
  }
}
