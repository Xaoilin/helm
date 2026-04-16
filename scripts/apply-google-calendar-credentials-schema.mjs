import { readFileSync } from 'node:fs'

const managementApiBaseUrl =
  process.env.SUPABASE_MANAGEMENT_API_URL?.trim() || 'https://api.supabase.com'
const projectRef = process.env.SUPABASE_PROJECT_REF?.trim()
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const migrationPath = new URL(
  '../supabase/migrations/20260415090000_google_calendar_credentials.sql',
  import.meta.url,
)
const migrationSql = readFileSync(migrationPath, 'utf8').trim()

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`${name} is required to apply the hosted Google Calendar schema.`)
  }
  return value
}

async function applyGoogleCalendarCredentialsSchema() {
  const resolvedProjectRef = requireEnv('SUPABASE_PROJECT_REF', projectRef)
  const resolvedAccessToken = requireEnv('SUPABASE_ACCESS_TOKEN', accessToken)

  if (!migrationSql) {
    throw new Error('The google_calendar_credentials migration file is empty.')
  }

  const response = await fetch(
    `${managementApiBaseUrl}/v1/projects/${encodeURIComponent(resolvedProjectRef)}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: migrationSql,
      }),
    },
  )

  if (!response.ok) {
    const responseText = (await response.text()).trim()
    throw new Error(
      `Supabase Management API database/query failed with ${response.status}: ${responseText || 'No response body.'}`,
    )
  }

  console.log(
    `Ensured hosted Google Calendar schema exists on Supabase project ${resolvedProjectRef}.`,
  )
}

applyGoogleCalendarCredentialsSchema().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
