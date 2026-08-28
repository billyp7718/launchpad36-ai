
import postgres from 'postgres';

let client;

export function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  if (!client) {
    client = postgres(process.env.DATABASE_URL, {
      ssl: 'require',
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false
    });
  }
  return client;
}

export async function upsertAccount(a={}) {
  const sql=db();
  const rows=await sql`
    insert into accounts (name, type, coverage, region, domain, category, potential, score, notes, source, updated_at)
    values (
      ${a.name||''}, ${a.type||''}, ${a.coverage||''}, ${a.region||''}, ${a.domain||''},
      ${a.category||''}, ${Number(a.potential)||0}, ${Number(a.score)||0}, ${a.notes||''},
      ${a.source||'app'}, now()
    )
    on conflict (lower(name)) do update set
      type=excluded.type, coverage=excluded.coverage, region=excluded.region, domain=excluded.domain,
      category=excluded.category, potential=excluded.potential, score=excluded.score,
      notes=excluded.notes, source=excluded.source, updated_at=now()
    returning *`;
  return rows[0];
}

export async function upsertBuyer(b={}) {
  const sql=db();
  const rows=await sql`
    insert into buyers (account_id, name, title, email, phone, linkedin, category, source, source_url, confidence, verified_at, status, notes, updated_at)
    values (
      ${b.account_id||null}, ${b.name||''}, ${b.title||''}, ${b.email||''}, ${b.phone||''},
      ${b.linkedin||''}, ${b.category||''}, ${b.source||'public'}, ${b.source_url||''},
      ${Number(b.confidence)||0}, ${b.verified_at||null}, ${b.status||'Current'}, ${b.notes||''}, now()
    )
    on conflict (account_id, lower(name), lower(title)) do update set
      email=excluded.email, phone=excluded.phone, linkedin=excluded.linkedin, category=excluded.category,
      source=excluded.source, source_url=excluded.source_url, confidence=excluded.confidence,
      verified_at=excluded.verified_at, status=excluded.status, notes=excluded.notes, updated_at=now()
    returning *`;
  return rows[0];
}

export async function upsertCompetitiveProduct(p={}) {
  const sql=db();
  const rows=await sql`
    insert into competitive_products
      (account_id, brand, product_name, category, price_text, price_numeric, availability, source_url, verified_at, active, raw_text, updated_at)
    values (
      ${p.account_id||null}, ${p.brand||''}, ${p.product_name||p.product||''}, ${p.category||''},
      ${p.price_text||p.price||''}, ${Number(p.price_numeric)||0}, ${p.availability||''},
      ${p.source_url||''}, ${p.verified_at||null}, true, ${p.raw_text||p.product||''}, now()
    )
    on conflict (account_id, brand, product_name, source_url) do update set
      category=excluded.category, price_text=excluded.price_text, price_numeric=excluded.price_numeric,
      availability=excluded.availability, verified_at=excluded.verified_at, active=true,
      raw_text=excluded.raw_text, updated_at=now()
    returning *`;
  return rows[0];
}
