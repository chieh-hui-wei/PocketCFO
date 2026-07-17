import unittest
import asyncio
from src.controllers.ai_assistant import chat_assistant, execute_sql_query, ChatRequest, ChatMessage, SQLRequest
from src.instances.database import AsyncSessionLocal

class TestAIAssistant(unittest.IsolatedAsyncioTestCase):
    async def test_chat_assistant(self):
        """Test sending a prompt to Gemini and receiving a response."""
        req = ChatRequest(
            message="Hello! Say 'PocketCFO AI is ready' and nothing else.",
            history=[]
        )
        res = await chat_assistant(req)
        self.assertIn("response", res)
        self.assertGreater(len(res["response"]), 0)
        print("Gemini Chat Response test output:", res["response"])

    async def test_sql_query_success(self):
        """Test executing a valid SELECT query."""
        async with AsyncSessionLocal() as db:
            sql_req = SQLRequest(query="SELECT 1 as val;")
            res = await execute_sql_query(sql_req, db)
            self.assertEqual(res["columns"], ["val"])
            self.assertEqual(res["rows"], [["1"]])

    async def test_sql_query_forbidden(self):
        """Test that invalid/modifying statements (e.g. DROP) are blocked."""
        async with AsyncSessionLocal() as db:
            sql_req = SQLRequest(query="DROP TABLE accounts;")
            with self.assertRaises(Exception) as ctx:
                await execute_sql_query(sql_req, db)
            self.assertIn("Only read-only SELECT and WITH statements are allowed", str(ctx.exception))

if __name__ == '__main__':
    unittest.main()
