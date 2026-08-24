
const directory = {
  "bestbuy.com": [
    {
      name: "Best Buy corporate merchandising team",
      title: "Buyer / Merchant / Category leadership",
      organization: "Best Buy",
      location: "Richfield, Minnesota",
      linkedin_url: "https://www.linkedin.com/company/best-buy",
      source_url: "https://www.linkedin.com/company/best-buy",
      source_label: "Best Buy LinkedIn company page",
      confidence: 78,
      note: "Public source confirms the corporate organization; the specific category buyer should be verified before outreach."
    },
    {
      name: "Jonathan Greer",
      title: "Best Buy digital / marketplace leadership",
      organization: "Best Buy",
      location: "New York City Metropolitan Area",
      linkedin_url: "https://www.linkedin.com/in/jonathan-greer-3b040821",
      source_url: "https://www.linkedin.com/in/jonathan-greer-3b040821",
      source_label: "LinkedIn",
      confidence: 62,
      note: "Relevant to digital/marketplace strategy; may not own the specific retail category."
    }
  ],
  "crutchfield.com": [
    {
      name: "Crutchfield merchandising team",
      title: "Audio / video category leadership",
      organization: "Crutchfield Corporation",
      location: "Charlottesville, Virginia",
      linkedin_url: "https://www.linkedin.com/company/crutchfield-corporation",
      source_url: "https://www.linkedin.com/company/crutchfield-corporation",
      source_label: "Crutchfield LinkedIn company page",
      confidence: 76,
      note: "Public company information confirms category specialization in mobile audio, speakers, TVs and headphones."
    }
  ],
  "bhphotovideo.com": [
    {
      name: "B&H merchandising team",
      title: "Buyer / Category manager — audio & electronics",
      organization: "B&H Photo Video",
      location: "New York, New York",
      linkedin_url: "",
      source_url: "https://www.bhphotovideo.com/",
      source_label: "B&H public website",
      confidence: 58,
      note: "Role inferred from retailer structure; the specific person requires verification."
    }
  ],
  "abt.com": [
    {
      name: "Abt electronics merchandising team",
      title: "Buyer / Category manager — electronics",
      organization: "Abt Electronics",
      location: "Glenview, Illinois",
      linkedin_url: "",
      source_url: "https://www.abt.com/",
      source_label: "Abt public website",
      confidence: 58,
      note: "Role inferred from retailer structure; the specific person requires verification."
    }
  ],
  "wwstereo.com": [
    {
      name: "World Wide Stereo merchandising team",
      title: "Buyer / Category leadership — premium AV",
      organization: "World Wide Stereo",
      location: "Pennsylvania",
      linkedin_url: "",
      source_url: "https://www.worldwidestereo.com/",
      source_label: "World Wide Stereo public website",
      confidence: 58,
      note: "Role inferred from retailer structure; the specific person requires verification."
    }
  ]
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const domain = String(req.query.domain || '').trim().toLowerCase();
  if (!domain) return res.status(400).json({ error: 'Retailer domain is required.' });

  const people = directory[domain] || [{
    name: `${String(req.query.retailer || 'Retailer')} merchandising team`,
    title: 'Buyer / Merchant / Category leadership',
    organization: String(req.query.retailer || domain),
    location: '',
    linkedin_url: '',
    source_url: `https://${domain}`,
    source_label: 'Retailer public website',
    confidence: 45,
    note: 'Specific buyer not yet verified. Use public company/professional sources to confirm the current category owner.'
  }];

  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  return res.status(200).json({
    people,
    method: 'public-source',
    warning: 'Public-source leads should be verified before outreach. No email or phone data is inferred.'
  });
}
