const DEFAULT_API_VERSION = process.env.SALESFORCE_API_VERSION || 'v60.0';

async function getSalesforceToken() {
  const loginUrl = process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com';
  const required = ['SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET', 'SALESFORCE_USERNAME', 'SALESFORCE_PASSWORD'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: process.env.SALESFORCE_CLIENT_ID,
    client_secret: process.env.SALESFORCE_CLIENT_SECRET,
    username: process.env.SALESFORCE_USERNAME,
    password: `${process.env.SALESFORCE_PASSWORD}${process.env.SALESFORCE_SECURITY_TOKEN || ''}`,
  });

  const response = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error_description || json.error || 'Salesforce authentication failed');
  }

  return json;
}

async function querySalesforce(token, soql) {
  const records = [];
  let nextUrl = `/services/data/${DEFAULT_API_VERSION}/query?q=${encodeURIComponent(soql)}`;

  while (nextUrl) {
    const response = await fetch(`${token.instance_url}${nextUrl}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const json = await response.json();
    if (!response.ok) {
      throw new Error(json?.[0]?.message || json.message || 'Salesforce query failed');
    }
    records.push(...(json.records || []));
    nextUrl = json.done ? null : json.nextRecordsUrl;
  }

  return records.map(({ attributes, ...record }) => record);
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
    if (process.env.USE_MOCK_DATA === '1') {
      return res.status(200).json({ mock: true, records: [] });
    }
    const token = await getSalesforceToken();
    const records = await querySalesforce(token, getCaseQuery());
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
    return res.status(200).json({ mock: false, totalSize: records.length, records });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
