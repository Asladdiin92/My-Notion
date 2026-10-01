# Notion Academic & Life Dashboard

A personal dashboard built with **Next.js and React**. Your existing Notion
database is the source of truth: the dashboard reads tasks from Notion, turns
them into charts, progress indicators, and a deadline calendar, and lets you
create, edit, and archive planner items in the same database.

This guide explains how the application works, what each part is for, and how
to run, extend, and deploy it.

## Contents

- [How the project works](#how-the-project-works)
- [Technology used](#technology-used)
- [How Notion data flows through the app](#how-notion-data-flows-through-the-app)
- [Understanding the dashboard calculations](#understanding-the-dashboard-calculations)
- [Project structure](#project-structure)
- [Run it locally](#run-it-locally)
- [Connect your Notion database](#connect-your-notion-database)
- [Deploy to Vercel](#deploy-to-vercel)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Ideas for learning and extending the project](#ideas-for-learning-and-extending-the-project)

## How the project works

The browser displays the dashboard, but it does **not** talk directly to
Notion. Clerk authenticates the user, and the server checks the signed-in
account against a verified-email allowlist before returning planner data or
creating a Notion item. The `/api/tasks` endpoint then reads the Notion
credentials from server environment variables, contacts the Notion API, and
returns task data to the browser.

When you create, edit, or archive a planner item, the browser calls this app's
API. The server checks the Clerk session and verified-email allowlist, validates
the input against the Notion database schema, and then makes the Notion change.
The planner assistant can turn natural-language instructions into a proposed
create or edit. It only reads Notion to prepare the proposal; you must confirm
the preview before the browser calls the existing create or edit API.

```text
Your browser (React dashboard + Clerk sign-in)
        │
        │ Clerk session cookie
        ▼
Next.js middleware + API access check (allowlisted verified email)
        │
        │ GET /api/tasks            load tasks and database options
        │ POST /api/tasks           create a planner item
        │ PATCH /api/tasks/:id      edit a planner item
        │ DELETE /api/tasks/:id     archive a planner item
        │ POST /api/assistant      ask, get suggestions, or prepare a change preview
        ▼
Next.js server (API routes + Notion mapping)
        │
        │ NOTION_API_KEY / NOTION_TOKEN / GEMINI_API_KEY (server-only)
        │ NOTION_DATABASE_ID
        ▼
Notion API (your existing planner database)
```

The Notion secret stays on the server. It is never intentionally included in
the browser bundle or API response.

## Technology used

| Technology | What it does in this project |
| --- | --- |
| **Next.js App Router** | Provides the website, page layout, server-side API routes, middleware, and production build. |
| **Clerk** | Handles sign-in and sessions; a server-verified email allowlist authorizes planner access. |
| **React** | Builds the interactive dashboard, calendar, task table, and planner-item forms/actions from reusable components. |
| **TypeScript** | Gives task data and API request/response objects explicit types so mismatched fields can be caught during a build. |
| **Recharts** | Draws the status, priority, task type, and timeline charts. |
| **Lucide React** | Supplies consistent icons for navigation, metrics, actions, and states. |
| **Notion REST API** | Stores the real planner data and creates, updates, or archives pages in your database. This project calls it with the server's built-in `fetch`; it does not need the Notion SDK. |
| **CSS** | Styles the responsive layout, charts, calendar, form, and phone/tablet views. |
| **Vercel** | Can host the Next.js app and supply production environment variables. |

Dependencies and commands are recorded in `package.json` and
`package-lock.json`. No separate application database is used: **Notion is the
database**.

## How Notion data flows through the app

### 1. The page asks the app for data

The dashboard component in `app/page.tsx` sends a browser request:

```ts
fetch("/api/tasks", { cache: "no-store" })
```

The browser can only reach this same-origin route. Clerk middleware requires a
signed-in session, and the route independently checks that the account has a
verified address in `ALLOWED_EMAILS`. Authorized users receive normalized task
objects plus the valid select/status choices used to build the create-item form.

### 2. The server loads tasks and Notion options

`app/api/tasks/route.ts` implements `GET /api/tasks`. It loads:

- **Planner pages** from the database.
- **Database properties and options**, so form choices can match your real
  Notion configuration.

The server loads these in parallel and does not cache the responses. When
Notion returns more than one result page, `lib/notion.ts` follows Notion's
pagination cursor until it has loaded all results (up to the app's 2,000-item
limit).

### 3. Notion properties become predictable task objects

Notion returns pages with nested property structures. The mapping in
`lib/notion.ts` converts them into the simpler `Task` type from `lib/types.ts`:

| Dashboard field | Notion property by default | Used for |
| --- | --- | --- |
| `title` | `Item` (title) | Planner item name and task table link. |
| `type` | `Type` (select) | Task-type chart, badges, and create form. |
| `dueDate` | `Date` (date) | Calendar markers, upcoming deadlines, and overdue counts. |
| `status` | `Status` (status) | Status label and completion calculation. |
| `area` | `Area` (select) | Progress-by-area calculations. |
| `course` | `Course` (select for creation; select or rich text for reading) | Secondary label below a task title. |
| `priority` | `Priority` (select) | Priority chart and task table badge. |
| `nextAction` | `Next Action` (rich text) | Next-action column in the task table. |
| `completed` | `Completed` (checkbox), or completion status | Completed versus pending totals. |
| `createdAt` | Notion page creation time | Task timeline chart. |

These names are defaults based on the planner screenshot. If a property has a
different name in your database, set the corresponding environment variable.
The title property is also detected by its Notion title type if its name is
different.

### 4. Create a planner item

The **New item** button opens a form. Type, Status, Priority, Area, and Course
choices are fetched from your actual database schema; they are not hard-coded.
If a required choice isn't provided, creation defaults to `Deliverable` (or
`Task`, then the first Type option), `Planned` (or `Not started`, then the first
Status option), and `Medium` (or `Normal`, `Low`, then the first Priority
option). Optional Area, Course, due date, and Next action stay empty unless set.

When the form is submitted:

1. The browser sends JSON to `POST /api/tasks` with its Clerk session.
2. Middleware and the route check authentication; the route requires a
   verified, allowlisted email, checks request origin, and validates input.
3. `lib/notion.ts` checks the date and confirms the chosen values exist in the
   correct Notion property options.
4. The server uses Notion's create-page endpoint to add an item to
   `NOTION_DATABASE_ID`.
5. The returned Notion page is mapped to a `Task`; React adds it to the table
   and recalculates the dashboard.

The table's **Edit** action opens the form with current values; saving calls
`PATCH /api/tasks/:id`, and blank optional fields clear their Notion values.
**Delete** asks for confirmation and calls `DELETE /api/tasks/:id`, which
archives the page in Notion rather than permanently deleting it. Archived items
can be restored from Notion's trash.

## Understanding the dashboard calculations

- **Task status chart:** a task is completed when the `Completed` checkbox is
  checked, or when its status is exactly `Done`, `Complete`, `Completed`, or
  `Finished` (case-insensitive). All other tasks count as pending.
- **Priority distribution:** counts tasks by their Priority option. Unassigned
  priority values are left out of the chart.
- **Task-type distribution:** counts tasks by their Type option. Blank types
  appear in the task table as `Other` and are omitted from the distribution
  chart.
- **Task timeline:** groups pages by their Notion `created_time` month for the
  current month and the previous five months. This is when the page was
  created, not the planner due date.
- **Deadline calendar:** shows the task due dates from the Notion Date
  property. The upcoming list shows the next three non-completed tasks due
  today or later.
- **Overdue count:** counts tasks that are not completed and have a due date
  earlier than today's local date.
- **Progress by area:** groups tasks by Area and displays
  `completed tasks / total tasks` and that area's completion percentage.
- **Search and refresh:** task search filters the currently loaded tasks in the
  browser. **Refresh** makes fresh requests to the API and Notion.

## Project structure

```text
notion-dashboard/
├── app/
│   ├── api/assistant/       # Server-side Gemini planner assistant
│   ├── api/tasks/route.ts   # GET task data/options and POST new items
│   ├── sign-in/             # Clerk sign-in page
│   ├── global-error.tsx     # Friendly recovery screen for unexpected errors
│   ├── globals.css          # Dashboard styles and responsive breakpoints
│   ├── layout.tsx           # Shared page layout and browser metadata
│   └── page.tsx             # Main dashboard, metrics, calendar, and item form
├── components/
│   ├── dashboard-charts.tsx # Recharts visualizations
│   └── planner-assistant.tsx # AI suggestions, task Q&A, and confirmed edits
├── lib/
│   ├── access.ts            # Verified-email allowlist check
│   ├── gemini.test.ts       # Gemini fallback behavior tests
│   ├── gemini.ts            # Server-side Gemini API requests
│   ├── notion.ts            # Notion API requests, validation, and mapping
│   └── types.ts             # Shared Task and API data types
├── middleware.ts            # Requires Clerk sign-in for app/API routes
├── .env.example             # Safe placeholder template to copy from
├── .env.local               # Your local secrets; ignored by Git
├── .gitignore               # Excludes secrets, build output, and dependencies
├── next.config.ts           # Next.js configuration
├── package.json             # Dependencies and npm scripts
├── package-lock.json        # Exact dependency resolution for repeatable installs
└── tsconfig.json            # TypeScript compiler settings
```

### A few useful concepts

- A **React component** is a reusable part of the interface. For example,
  `MetricCard`, `CalendarCard`, and `TaskTable` live in `app/page.tsx`.
- A **client component** has the `"use client"` directive because it uses
  browser interactions and React state. The dashboard page and chart components
  are client components.
- An **API route** is a server-side URL implemented by a `route.ts` file.
  `app/api/tasks/route.ts` handles `GET` and `POST`; `app/api/tasks/[id]/route.ts`
  handles item updates and archives.
- An **environment variable** is configuration supplied to the server at
  runtime. `NOTION_API_KEY` and `GEMINI_API_KEY` are secret; do not prefix them
  with `NEXT_PUBLIC_`.
- A **Notion integration** is the authenticated connection the app uses. It
  must be explicitly shared with your existing planner database.
- A **TypeScript type** such as `Task` describes the fields an object should
  contain and helps detect mistakes before running the app.

## Run it locally

Install **Node.js 20 or newer**. From this project directory, run:

```bash
npm install
```

The project already includes an ignored `.env.local` file. Keep it and fill it
in. If you remove it and need to make a new one from the example, run:

```bash
cp .env.example .env.local
```

Fill in the required values in `.env.local`:

```dotenv
NOTION_API_KEY=secret_your_notion_integration_token
NOTION_DATABASE_ID=your_notion_database_id
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
ALLOWED_EMAILS=your_verified_email@example.com
GEMINI_API_KEY=your_gemini_api_key
```

The email must be verified in Clerk. `ALLOWED_EMAILS` is enforced server-side
by the API; do not expose it as a `NEXT_PUBLIC_` variable. The Gemini key is
used only by the server-side planner assistant; never add a `NEXT_PUBLIC_`
prefix to it.

The **Planner assistant** can suggest next actions, answer questions, or
interpret instructions such as “add a biology review task tomorrow” or “move
my biology deadline to Friday.” For create/edit instructions, it shows a
preview and changes nothing in Notion until you select **Confirm**. It asks
for clarification if an edit does not clearly match a task; archiving tasks
is not available through the assistant. For each request, the server fetches
planner data and sends selected task details to Google's Gemini API. Task
details are limited to 150 items per request; aggregate counts still cover
the full planner. Requests use Gemini 3.8 Flash first and automatically retry
with Gemini 3.5 Flash-Lite if the primary model is temporarily overloaded.
It also tries the fallback after a request timeout. Other errors, such as an
invalid API key, are reported without retrying.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Restart the server after
editing `.env.local`. Use **Refresh** on the page to reload database data.

Useful project commands:

```bash
npm run dev    # Start the development server
npm run lint   # Check code with ESLint
npm test      # Test Notion task defaults and Gemini fallback behavior
npm run build  # Type-check and build the production app
npm run start  # Serve a completed production build
```

## Connect your Notion database

1. Create or reuse your Notion internal integration and copy its secret into
   `.env.local`.
2. In Notion, share your existing **Academic & Life Planner** database with
   that integration.
3. Give the integration **Read content**, **Insert content**, and **Update
   content** access. Read access loads tasks; insert creates items; update
   enables editing and archiving.
4. Copy the database ID into `NOTION_DATABASE_ID`. It is part of the database
   URL. Do not use the integration token as the database ID.
5. If you renamed a property, add the corresponding override shown in
   `.env.example`, for example:

   ```dotenv
   NOTION_TITLE_PROPERTY=Name
   NOTION_DUE_DATE_PROPERTY=Deadline
   NOTION_COMPLETED_PROPERTY=Done
   ```

Only set an override when a property name is different. The form supports the
database's select/status option properties, the date property, and rich-text
Next action property. If your database uses a different type for a field, adapt
the corresponding mapping in `lib/notion.ts`.

## Deploy to Vercel

1. Push the project to a Git repository you control and import it into Vercel.
2. In the Vercel project settings, add `NOTION_API_KEY` (or `NOTION_TOKEN`),
   `NOTION_DATABASE_ID`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
   `CLERK_SECRET_KEY`, `ALLOWED_EMAILS`, and `GEMINI_API_KEY` under
   **Environment Variables**. Use the Clerk keys from your Clerk application;
   set values for the Vercel environments you will use.
3. Add property-name overrides if necessary. Ensure the allowlisted email is
   verified in Clerk.
4. Redeploy after changing environment variables.

Do **not** upload `.env.local` or publish your integration secret. Vercel uses
the environment variables on its server to call Notion.

## Security notes

- `.env.local` is excluded by `.gitignore`; `.env.example` contains placeholders
  only. Check that your real token is not in a commit before pushing.
- Never expose the token in a `NEXT_PUBLIC_...` variable, client component, or
  browser request.
- `GEMINI_API_KEY` is sent to Google only from the server. Planner task details
  are sent to Gemini when using the assistant; do not use it if you do not want
  that data processed by Google.
- Clerk middleware requires sign-in, and each task API method separately
  checks the signed-in user's verified email against the server-only
  `ALLOWED_EMAILS` allowlist. The dashboard UI is not the security boundary.
- Configure Clerk's sign-in settings and verify the intended account email.
  The API denies access when `ALLOWED_EMAILS` is missing or does not match.
- The POST route also checks same-origin requests and validates values against
  the Notion database schema. Keep the integration scoped to the pages it needs.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| “Add `NOTION_API_KEY` and `NOTION_DATABASE_ID`...” | Fill both values in `.env.local` and restart `npm run dev`. `NOTION_TOKEN` is also accepted instead of `NOTION_API_KEY`. |
| Clerk reports missing keys | Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` locally and in the Vercel project, then restart or redeploy. |
| Planner assistant reports a missing Gemini key | Set `GEMINI_API_KEY` in `.env.local` or the Vercel environment, then restart or redeploy. |
| Gemini rejects the API key | Check that `GEMINI_API_KEY` is valid and that the Gemini API is enabled for its Google project. |
| Sign-in works but planner access is denied | Verify the signed-in email in Clerk and add the exact address to server-side `ALLOWED_EMAILS`. |
| Notion returns 401 | Check that the integration secret is correct and active. |
| Notion returns 404 | Check the database ID and share that database with the integration. |
| A task option is rejected | Refresh the dashboard and select an option that currently exists in Notion. |
| Creating an item reports a property error | Check the relevant property name and type in Notion, then correct the corresponding variable in `.env.local`. |
| The dashboard shows no tasks | Check that the integration has read access and that the shared database contains planner pages. |
| The task list is longer than 2,000 items | Add a Notion database filter before extending the pagination limit. |
| A development popup says “Try Turbopack” | This is a Next.js development suggestion, not a Notion connection error. It is safe to dismiss. |

## Ideas for learning and extending the project

If you are using this app to understand web development, these are useful
starting points:

1. Read `app/page.tsx` from top to bottom. Notice how React `useState` stores
   the tasks, loading state, search text, and open form state.
2. Follow `loadTasks` from the page into `GET /api/tasks`, then into
   `fetchNotionTasks` in `lib/notion.ts`. This is a complete example of data
   moving from a browser through a server to an external API and back.
3. Follow the create form's `submitTask` into `POST /api/tasks` and
   `createNotionTask`. Compare the form's values with the actual property
   payload sent to Notion.
4. Read `lib/types.ts` to see how TypeScript describes the task and API
   response shapes.
5. Read `components/dashboard-charts.tsx` to see how grouped data becomes
   charts using Recharts.
6. Change a visual rule in `app/globals.css`, run `npm run dev`, and see how
   Next.js updates the page while it is running.
7. After a change, run `npm run lint` and `npm run build`. A successful build
   checks TypeScript types and produces the production app.

Good next features to learn include filtering by status or area, editing a
Notion page with a validated `PATCH` API route, adding authentication, and
writing automated tests around the Notion-property mapping.
