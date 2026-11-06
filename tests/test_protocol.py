import unittest

from protocol import decode, encode


class ProtocolTests(unittest.TestCase):
    def test_status_sync_is_signed_internal_protocol(self):
        secret = "0123456789abcdef"
        wire = encode("status_sync", task_id="wg-0123456789abcdef", from_bot="10001",
                      to_bot="10002", payload={"items": [{"bot_id": "10001", "online": True}]},
                      secret=secret)
        self.assertTrue(wire.startswith("[WG] "))
        body = decode(wire, secret=secret, sender_id="10001",
                      roster={"10001": {}, "10002": {}}, group_id="20001",
                      expected_group="20001")
        self.assertEqual(body["type"], "status_sync")
        self.assertTrue(body["payload"]["items"][0]["online"])


if __name__ == "__main__":
    unittest.main()
