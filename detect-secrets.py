from detect_secrets import SecretsCollection
from detect_secrets.settings import default_settings
import json
import sys


if __name__ == "__main__":

    res = {}

    try:
        if len(sys.argv) != 2:
            raise Exception

        # 0th arg is the file name
        file = sys.argv[1]
        secrets = SecretsCollection()
        with default_settings():
            secrets.scan_file(file)

        print(json.dumps(secrets.json(), indent=2))

    except:
        print(json.dumps(res))
