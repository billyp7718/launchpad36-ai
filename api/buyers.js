const leads={
"bestbuy.com":[{name:"Best Buy merchandising organization",title:"Home Audio / Home Theater buyer & merchant leadership",organization:"Best Buy",location:"Richfield, Minnesota",source_url:"https://corporate.bestbuy.com/",confidence:75,note:"Use the public corporate source to verify the current category owner before outreach."}],
"crutchfield.com":[{name:"Crutchfield merchandising organization",title:"Home Audio category leadership",organization:"Crutchfield",location:"Charlottesville, Virginia",source_url:"https://www.crutchfield.com/",confidence:75,note:"Verify the current named category owner before outreach."}],
"abt.com":[{name:"Abt Electronics merchandising organization",title:"Electronics / Audio buying leadership",organization:"Abt Electronics",location:"Glenview, Illinois",source_url:"https://www.abt.com/",confidence:65,note:"Specific named buyer requires verification."}],
"bhphotovideo.com":[{name:"B&H merchandising organization",title:"Audio / Electronics buyer leadership",organization:"B&H Photo Video",location:"New York, New York",source_url:"https://www.bhphotovideo.com/",confidence:65,note:"Specific named buyer requires verification."}]
};
export default function handler(req,res){
 const domain=String(req.query.domain||'').toLowerCase();
 const retailer=String(req.query.retailer||domain||'Retailer');
 const people=leads[domain]||[{name:retailer+" merchandising organization",title:"Buyer / Merchant / Category leadership",organization:retailer,location:"",source_url:domain?"https://"+domain:"",confidence:45,note:"Specific named buyer not yet verified."}];
 res.status(200).json({people,method:"public-source"});
}