# Salesforce Ticket Dashboard on Vercel

This project turns the standalone ticket dashboard into a Vercel app with secure Salesforce API routes.

## Files

- `index.html` — Chrome-ready dashboard UI with auto-refresh every 5 minutes.
- `api/dashboard-summary.js` — Secure Salesforce summary API used by the dashboard.
- `api/salesforce-cases.js` — Raw Salesforce Case fetch endpoint for debugging/export.
- `.env.example` — Environment variables to add in Vercel.

## Vercel setup

1. Upload/import this folder into a GitHub repository.
2. Import the repository into Vercel.
3. Add the environment variables from `.env.example` in Vercel Project Settings → Environment Variables.
4. Deploy.

## Salesforce setup

Create a Salesforce Connected App and enable OAuth/API access. Add the connected app Client ID and Client Secret to Vercel.

Required Salesforce fields used by the API:

```sql
Id, CaseNumber, Status, Origin, Type, Sub_Type__c,
Milestone_16_Hours__c, Owner.Name, CreatedDate, ClosedDate,
Enrollment_Status__c, Semester__c, Batch__c
```

If any custom field API name differs in your Salesforce org, update the SOQL query in both API files.

## Important security note

Do not put Salesforce credentials in `index.html`. Keep them only in Vercel Environment Variables.
