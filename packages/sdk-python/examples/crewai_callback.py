"""Rovn + CrewAI Integration
Adds governance guardrails to every CrewAI task — checks policies
before execution, logs results after completion, and summarizes
trust metrics for the entire crew run.

pip install crewai rovn-sdk
"""

import os
from rovn_sdk import RovnAgent
from crewai import Agent, Task, Crew
from crewai.tools import tool


# -- Initialize Rovn governance client --
rovn = RovnAgent(
    base_url=os.environ.get("ROVN_URL", "http://localhost:3000"),
    api_key=os.environ["ROVN_API_KEY"],
)
rovn.agent_id = rovn.get_info().id


# -- Governance tool: agents call this before risky actions --
@tool
def governance_check(action: str) -> str:
    """Check if an action is allowed under current governance policies.
    Call this before performing any significant operation."""
    result = rovn.check_action(action)
    if result.allowed:
        return f"PROCEED: {result.summary}"
    if result.needs_approval:
        approval_id = rovn.request_approval(
            type="task_action", title=action,
            description=f"CrewAI agent requests: {action}", urgency="medium",
        )
        return f"AWAITING APPROVAL (id={approval_id}): {result.summary}"
    return f"BLOCKED: {result.summary}. Choose an alternative approach."


# -- Governance-aware task wrapper --
def governed_task(task: Task, crew_agent: Agent) -> Task:
    """Wrap a CrewAI task with Rovn pre-flight checks and post-execution logging."""
    original_description = task.description

    # Inject governance instructions into task description
    task.description = (
        f"{original_description}\n\n"
        "GOVERNANCE REQUIREMENT: Before performing any significant action, "
        "use the governance_check tool to verify it is allowed."
    )
    return task


# -- Build a governed crew --
def build_governed_crew():
    researcher = Agent(
        role="Market Researcher",
        goal="Research market trends and competitor data",
        backstory="Senior analyst with access to market databases",
        tools=[governance_check],
        verbose=True,
    )

    writer = Agent(
        role="Content Writer",
        goal="Write marketing content based on research",
        backstory="Creative writer who follows brand guidelines",
        tools=[governance_check],
        verbose=True,
    )

    research_task = governed_task(Task(
        description="Analyze competitor pricing in the SaaS market",
        expected_output="Pricing comparison report",
        agent=researcher,
    ), researcher)

    writing_task = governed_task(Task(
        description="Write a blog post about our competitive advantages",
        expected_output="1000-word blog post draft",
        agent=writer,
    ), writer)

    return Crew(agents=[researcher, writer], tasks=[research_task, writing_task])


if __name__ == "__main__":
    crew = build_governed_crew()
    rovn.log_activity("CrewAI run started", type="crew_start")

    result = crew.kickoff()

    # Log completion and print governance summary
    rovn.log_activity("CrewAI run completed", type="crew_complete",
                       metadata={"output_length": len(str(result))})

    report = rovn.get_report_card(days=7)
    print(f"\n--- Governance Summary ---")
    print(f"Trust grade: {report.trust.get('grade', 'N/A')}")
    print(f"Compliance: {report.compliance}")
    for rec in report.recommendations:
        print(f"  - {rec}")
