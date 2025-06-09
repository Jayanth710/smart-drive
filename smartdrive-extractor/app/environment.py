import os
from dataclasses import dataclass
from typing import List


@dataclass
class Environment:
    port: int
    # database_url: str #*db
    use_flask_debug_mode: bool
    root_log_level: str
    starter_log_level: str

    @classmethod
    def from_env(cls) -> 'Environment':
        return cls(
            # port=int(os.environ.get('PORT', 5001)), 
            port = int(os.getenv("PORT", 8080)) ,
            # database_url=cls.__require_env('DATABASE_URL'), #*db
            use_flask_debug_mode=os.environ.get('USE_FLASK_DEBUG_MODE', 'false') == 'true',
            root_log_level=os.environ.get('ROOT_LOG_LEVEL', 'INFO'),
            starter_log_level=os.environ.get('STARTER_LOG_LEVEL', 'INFO'),
            
        )

    @classmethod
    def __require_env(cls, name: str) -> str:
        value = os.environ.get(name)
        if value is None:
            raise Exception(f'Unable to read {name} from the environment')
        return value
