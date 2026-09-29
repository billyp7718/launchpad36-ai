export const ROLES=Object.freeze({ADMIN:'ADMIN',MANAGER:'MANAGER',MEMBER:'MEMBER',VIEWER:'VIEWER'});
export const CAPABILITIES=Object.freeze({
  APP_READ:'APP_READ',APP_WRITE:'APP_WRITE',DEEP_SEARCH:'DEEP_SEARCH',DEEP_MARKET_ANALYSIS:'DEEP_MARKET_ANALYSIS',
  USER_ADMIN_TENANT:'USER_ADMIN_TENANT',USER_ADMIN_TEAM:'USER_ADMIN_TEAM',TENANT_SECURITY:'TENANT_SECURITY',SEE_ALL_BUSINESS_DATA:'SEE_ALL_BUSINESS_DATA'
});
const MATRIX=Object.freeze({
  ADMIN:new Set(Object.values(CAPABILITIES)),
  MANAGER:new Set([CAPABILITIES.APP_READ,CAPABILITIES.APP_WRITE,CAPABILITIES.DEEP_SEARCH,CAPABILITIES.DEEP_MARKET_ANALYSIS,CAPABILITIES.USER_ADMIN_TEAM,CAPABILITIES.SEE_ALL_BUSINESS_DATA]),
  MEMBER:new Set([CAPABILITIES.APP_READ,CAPABILITIES.APP_WRITE,CAPABILITIES.DEEP_SEARCH]),
  VIEWER:new Set([CAPABILITIES.APP_READ])
});

export function canonicalRole(value='MEMBER'){const role=String(value||'MEMBER').trim().toUpperCase();return role==='OWNER'?ROLES.ADMIN:Object.hasOwn(ROLES,role)?ROLES[role]:ROLES.MEMBER}
export function roleCapabilities(value){return [...MATRIX[canonicalRole(value)]]}
export function hasCapability(actor,capability){if(actor?.source==='admin_bearer')return true;return MATRIX[canonicalRole(actor?.role||actor)]?.has(capability)===true}
export function requireCapability(actor,res,capability){if(hasCapability(actor,capability))return true;res.status(403).json({error:`${canonicalRole(actor?.role)} does not have ${String(capability).toLowerCase().replaceAll('_',' ')} permission`,code:'FORBIDDEN',required_capability:capability});return false}
export function permissionSummary(actor={}){const role=canonicalRole(actor.role),capabilities=roleCapabilities(role);return {role,capabilities,can_write:capabilities.includes(CAPABILITIES.APP_WRITE),can_deep_search:capabilities.includes(CAPABILITIES.DEEP_SEARCH),can_deep_market_analysis:capabilities.includes(CAPABILITIES.DEEP_MARKET_ANALYSIS),can_administer_tenant_users:capabilities.includes(CAPABILITIES.USER_ADMIN_TENANT),can_administer_team_users:capabilities.includes(CAPABILITIES.USER_ADMIN_TEAM),can_manage_tenant_security:capabilities.includes(CAPABILITIES.TENANT_SECURITY)}}
export function managerMayGrant(role){return [ROLES.MEMBER,ROLES.VIEWER].includes(canonicalRole(role))}
export function teamScopeIncludes(actorTeamIds=[],targetTeamIds=[]){const allowed=new Set(actorTeamIds.map(String));return targetTeamIds.some(id=>allowed.has(String(id)))}
