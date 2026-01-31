{
  "targets": [
    {
      "target_name": "bitokpow",
      "sources": [
        "src/bitokpow.cc",
        "crypto/yespower-opt.c",
        "crypto/yespower_dispatch.c",
        "crypto/sha256.c"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "crypto"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-fexceptions",
        "-O3"
      ],
      "cflags": [
        "-O3",
        "-fPIC"
      ],
      "defines": [
        "NAPI_VERSION=8"
      ],
      "conditions": [
        ["OS=='linux'", {
          "cflags": [
            "-pthread"
          ],
          "ldflags": [
            "-pthread"
          ]
        }],
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_CFLAGS": [
              "-O3"
            ],
            "OTHER_CPLUSPLUSFLAGS": [
              "-std=c++17",
              "-O3"
            ]
          }
        }],
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "Optimization": 3,
              "AdditionalOptions": [
                "/std:c++17"
              ]
            }
          }
        }]
      ]
    }
  ]
}
