const DEFAULT_API_VERSION = process.env.SALESFORCE_API_VERSION || 'v60.0';

async function getSalesforceToken() {
  const loginUrl = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: process.env.SALESFORCE_CLIENT_ID,
    client_secret: process.env.SALESFORCE_CLIENT_SECRET,
    username: process.env.SALESFORCE_USERNAME,
    password: `${process.env.SALESFORCE_PASSWORD || ''}${process.env.SALESFORCE_SECURITY_TOKEN || ''}`,
  });
  const response = await fetch(`${loginUrl}/services/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error_description || json.error || 'Salesforce authentication failed');
  return json;
}

async function querySalesforce(token, soql) {
  const records = [];
  let nextUrl = `/services/data/${DEFAULT_API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  while (nextUrl) {
    const response = await fetch(`${token.instance_url}${nextUrl}`, { headers: { Authorization: `Bearer ${token.access_token}` } });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.[0]?.message || json.message || 'Salesforce query failed');
    records.push(...(json.records || []));
    nextUrl = json.done ? null : json.nextRecordsUrl;
  }
  return records.map(({ attributes, Owner, ...record }) => ({ ...record, OwnerName: Owner?.Name || 'Unassigned' }));
}

function countBy(records, getter) {
  const map = new Map();
  records.forEach((r) => {
    const key = getter(r) || 'Blank';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function topN(records, getter, n = 15) {
  return countBy(records, getter).slice(0, n);
}

function pct(num, den) { return den ? Math.round((num / den) * 1000) / 10 : 0; }

function dayKey(dateString) {
  const date = new Date(dateString);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function summarize(records) {
  const total = records.length;
  const closed = records.filter((r) => r.Status === 'Closed').length;
  const resolved = records.filter((r) => r.Status === 'Resolved').length;
  const breached = records.filter((r) => r.Milestone_16_Hours__c === true).length;
  const met = total - breached;
  const status = countBy(records, (r) => r.Status);
  const origin = countBy(records, (r) => r.Origin);
  const type = countBy(records, (r) => r.Type);
  const subtype = topN(records, (r) => r.Sub_Type__c, 15);
  const batch = topN(records, (r) => r.Batch__c, 12);
  const semester = countBy(records, (r) => r.Semester__c);
  const enrollment = countBy(records, (r) => r.Enrollment_Status__c);
  const dailyMap = new Map();
  records.forEach((r) => {
    const key = dayKey(r.CreatedDate);
    const item = dailyMap.get(key) || { label: key, total: 0, met: 0, breached: 0 };
    item.total += 1;
    if (r.Milestone_16_Hours__c === true) item.breached += 1;
    else item.met += 1;
    dailyMap.set(key, item);
  });
  const daily = [...dailyMap.values()].sort((a, b) => new Date(`2026/${a.label}`) - new Date(`2026/${b.label}`));

  const agents = countBy(records, (r) => r.OwnerName).slice(0, 20).map(([name, volume]) => {
    const owned = records.filter((r) => (r.OwnerName || 'Unassigned') === name);
    const agentBreached = owned.filter((r) => r.Milestone_16_Hours__c === true).length;
    return { n: name, v: volume, b: agentBreached, rate: Math.round(pct(agentBreached, volume)) };
  });

  return {
    refreshedAt: new Date().toISOString(),
    metrics: { total, closed, resolved, open: total - closed - resolved, met, breached, breachRate: pct(breached, total) },
    status: { labels: status.map(([k]) => k), data: status.map(([, v]) => v) },
    origin: { labels: origin.map(([k]) => k), data: origin.map(([, v]) => v) },
    type: { labels: type.map(([k]) => k), data: type.map(([, v]) => v) },
    subtype: { labels: subtype.map(([k]) => k), data: subtype.map(([, v]) => v) },
    daily: { labels: daily.map((d) => d.label), total: daily.map((d) => d.total), met: daily.map((d) => d.met), breached: daily.map((d) => d.breached) },
    agents,
    batch: { labels: batch.map(([k]) => k), data: batch.map(([, v]) => v) },
    semester: { labels: semester.map(([k]) => k), data: semester.map(([, v]) => v) },
    enrollment: { labels: enrollment.map(([k]) => k), data: enrollment.map(([, v]) => v) },
  };
}

function getCaseQuery() {
  const days = Number(process.env.SALESFORCE_CASE_DAYS || 30);
  return `
    SELECT Id, CaseNumber, Status, Origin, Type, Sub_Type__c,
           Milestone_16_Hours__c, Owner.Name, CreatedDate, ClosedDate,
           Enrollment_Status__c, Semester__c, Batch__c
    FROM Case
    WHERE CreatedDate = LAST_N_DAYS:${days}
    ORDER BY CreatedDate DESC
  `;
}

export default async function handler(req, res) {
  try {
    const required = ['SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_USERNAME', 'SALESFORCE_PASSWORD'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    const token = await getSalesforceToken();
    const records = await querySalesforce(token, getCaseQuery());
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
    return res.status(200).json(summarize(records));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
