from detect_secrets import SecretsCollection
from detect_secrets.settings import default_settings
from multiprocessing import Process
import json
import sys


def detect_secrets(file):
    secrets = SecretsCollection()
    with default_settings():
        secrets.scan_file(file)

    print(json.dumps(secrets.json()))


if __name__ == "__main__":

    res = {}

    try:
        if len(sys.argv) != 2:
            raise Exception

        # 0th arg is the file name
        file = sys.argv[1]
        proc = Process(target=detect_secrets,
                       name='detect_secrets', args=(file,))
        proc.start()
        proc.join(5)
        proc.terminate()

        # Indicates timeout
        if proc.exitcode is None:
            raise Exception

    except:
        print(json.dumps(res))
