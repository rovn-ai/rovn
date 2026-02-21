/**
 * Rovn + Vercel AI SDK Integration
 * Adds governance middleware so every tool call goes through
 * Rovn policy checks before execution.
 *
 * npm install ai @ai-sdk/openai rovn-sdk
 */

import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { RovnAgent, type CheckResult } from "rovn-sdk";
import { z } from "zod";

// -- Initialize Rovn governance client --
const rovn = new RovnAgent({
  baseUrl: process.env.ROVN_URL ?? "http://localhost:3000",
  apiKey: process.env.ROVN_API_KEY!,
});

// Auto-discover agent ID on startup
await rovn.getInfo();

// -- Governance middleware: checks policy before any tool executes --
async function governanceGate(action: string, cost?: number): Promise<CheckResult> {
  const result = await rovn.checkAction(action, { cost });
  await rovn.logActivity(`Pre-flight: ${action}`, {
    type: "preflight",
    metadata: { allowed: result.allowed, summary: result.summary },
  });
  return result;
}

// -- Define governed tools --
const sendEmailTool = tool({
  description: "Send an email to a recipient",
  parameters: z.object({
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Email subject"),
    body: z.string().describe("Email body"),
  }),
  execute: async ({ to, subject, body }) => {
    // Governance check before execution
    const check = await governanceGate("send_email", 0.01);
    if (!check.allowed && !check.needs_approval) {
      return { error: `Blocked by policy: ${check.summary}` };
    }
    if (check.needs_approval) {
      const approvalId = await rovn.requestApproval({
        type: "email", title: `Send email to ${to}: ${subject}`,
        description: body.slice(0, 200), urgency: "medium",
      });
      return { pending: true, approvalId, message: "Awaiting owner approval" };
    }
    // Simulated email send
    await rovn.logActivity(`Email sent to ${to}`, { type: "email_sent" });
    return { success: true, to, subject };
  },
});

const accessDatabaseTool = tool({
  description: "Query the customer database",
  parameters: z.object({
    query: z.string().describe("SQL query to execute"),
  }),
  execute: async ({ query }) => {
    const check = await governanceGate("database_query", 0);
    if (!check.allowed) {
      const approvalId = await rovn.requestApproval({
        type: "data_access", title: "Database query request",
        description: query.slice(0, 200), urgency: "high",
      });
      return { pending: true, approvalId, message: "Awaiting approval for DB access" };
    }
    await rovn.logActivity("Database query executed", { type: "db_query" });
    return { rows: [], message: "Query executed (simulated)" };
  },
});

// -- Run the governed agent --
async function main() {
  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    tools: { sendEmail: sendEmailTool, accessDatabase: accessDatabaseTool },
    maxSteps: 5,
    system:
      "You are a governed AI assistant. Use the provided tools to help users. " +
      "All actions are subject to governance policies enforced by Rovn.",
    prompt: "Send a summary email of last month's revenue to cfo@company.com",
  });

  console.log("Agent output:", text);

  // Print governance report
  const report = await rovn.getReportCard({ days: 7 });
  console.log(`\nTrust grade: ${report.trust?.grade ?? "N/A"}`);
  console.log("Recommendations:", report.recommendations);

  await rovn.close();
}

main().catch(console.error);
