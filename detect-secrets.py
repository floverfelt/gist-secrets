from detect_secrets import SecretsCollection
from detect_secrets.settings import default_settings
import timeout_decorator
import json
import sys


@timeout_decorator.timeout(5)
def detect_secrets(file):
    secrets = SecretsCollection()
    with default_settings():
        secrets.scan_file(file)

    return secrets


if __name__ == "__main__":

    res = {}

    try:
        if len(sys.argv) != 2:
            raise Exception

        # 0th arg is the file name
        file = sys.argv[1]
        secrets = detect_secrets(file)
        print(json.dumps(secrets.json(), indent=2))

    except:
        print(json.dumps(res))
