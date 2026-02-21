"""Rovn + LangChain Integration
Wraps Rovn governance checks as LangChain tools so your agent
automatically respects policies before taking any action.

pip install langchain langchain-openai rovn-sdk
"""

import os
from rovn_sdk import RovnAgent
from langchain.tools import tool
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_core.prompts import ChatPromptTemplate

# -- Initialize Rovn governance client --
rovn = RovnAgent(
    base_url=os.environ.get("ROVN_URL", "http://localhost:3000"),
    api_key=os.environ["ROVN_API_KEY"],
)
rovn.agent_id = rovn.get_info().id


@tool
def check_before_action(action: str, cost: float = 0.0) -> str:
    """Pre-flight governance check. Call this BEFORE performing any
    significant action (sending emails, accessing data, spending money).
    Returns whether the action is allowed under current policies."""
    result = rovn.check_action(action, cost=cost if cost else None)
    if result.allowed:
        rovn.log_activity(f"Action checked: {action}", type="preflight_pass")
        return f"ALLOWED: {result.summary}"
    if result.needs_approval:
        return f"NEEDS APPROVAL: {result.summary}. Use request_approval tool."
    return f"BLOCKED: {result.summary}"


@tool
def request_approval(action_type: str, title: str, description: str, urgency: str = "medium") -> str:
    """Request owner approval for a sensitive action. Use when
    check_before_action returns NEEDS APPROVAL. The agent should
    wait for approval before proceeding."""
    approval_id = rovn.request_approval(
        type=action_type,
        title=title,
        description=description,
        urgency=urgency,
    )
    if approval_id:
        approval = rovn.poll_approval(approval_id)
        return f"Approval requested (id={approval_id}, status={approval.status}). Wait for owner decision."
    return "Approval request failed."


@tool
def log_completed_action(title: str, description: str) -> str:
    """Log a completed action to Rovn for audit trail and trust scoring."""
    rovn.log_activity(title, type="action_complete", description=description)
    return "Activity logged."


# -- Build the governed agent --
def build_governed_agent():
    prompt = ChatPromptTemplate.from_messages([
        ("system",
         "You are a governed AI assistant. Before ANY significant action "
         "(sending emails, modifying data, making purchases), you MUST call "
         "check_before_action first. If blocked, stop. If approval needed, "
         "use request_approval. After completing actions, log them."),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ])
    llm = ChatOpenAI(model="gpt-4o-mini")
    tools = [check_before_action, request_approval, log_completed_action]
    agent = create_openai_tools_agent(llm, tools, prompt)
    return AgentExecutor(agent=agent, tools=tools, verbose=True)


if __name__ == "__main__":
    executor = build_governed_agent()
    # Every action goes through Rovn governance checks automatically
    result = executor.invoke({
        "input": "Send a marketing email to our 10k subscriber list"
    })
    print(result["output"])

    # Print report card at the end
    report = rovn.get_report_card(days=7)
    print(f"\nTrust grade: {report.trust.get('grade', 'N/A')}")
    print(f"Recommendations: {report.recommendations}")
