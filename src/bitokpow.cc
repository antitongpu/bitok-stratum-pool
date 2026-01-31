#include <node_api.h>
#include <cstring>
#include <cstdint>

extern "C" {
    #include "yespower.h"
}

#define YESPOWER_N 2048
#define YESPOWER_R 32
static const char* YESPOWER_PERS = "BitokPoW";
static const size_t YESPOWER_PERSLEN = 8;

static const yespower_params_t bitok_yespower_params = {
    YESPOWER_1_0,
    YESPOWER_N,
    YESPOWER_R,
    (const uint8_t*)YESPOWER_PERS,
    YESPOWER_PERSLEN
};

static napi_value Hash(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value args[1];
    napi_status status;

    status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (status != napi_ok) {
        napi_throw_error(env, nullptr, "Failed to parse arguments");
        return nullptr;
    }

    if (argc < 1) {
        napi_throw_error(env, nullptr, "Expected 1 argument: Buffer");
        return nullptr;
    }

    bool is_buffer;
    status = napi_is_buffer(env, args[0], &is_buffer);
    if (status != napi_ok || !is_buffer) {
        napi_throw_type_error(env, nullptr, "Argument must be a Buffer");
        return nullptr;
    }

    uint8_t* input_data;
    size_t input_length;
    status = napi_get_buffer_info(env, args[0], (void**)&input_data, &input_length);
    if (status != napi_ok) {
        napi_throw_error(env, nullptr, "Failed to get buffer data");
        return nullptr;
    }

    yespower_binary_t output;
    int result = yespower_tls(input_data, input_length, &bitok_yespower_params, &output);

    if (result != 0) {
        napi_throw_error(env, nullptr, "Yespower hash computation failed");
        return nullptr;
    }

    napi_value output_buffer;
    void* output_data;
    status = napi_create_buffer_copy(env, 32, output.uc, &output_data, &output_buffer);
    if (status != napi_ok) {
        napi_throw_error(env, nullptr, "Failed to create output buffer");
        return nullptr;
    }

    return output_buffer;
}

static napi_value VerifyBlock(napi_env env, napi_callback_info info) {
    size_t argc = 2;
    napi_value args[2];
    napi_status status;

    status = napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
    if (status != napi_ok) {
        napi_throw_error(env, nullptr, "Failed to parse arguments");
        return nullptr;
    }

    if (argc < 2) {
        napi_throw_error(env, nullptr, "Expected 2 arguments: header Buffer, target Buffer");
        return nullptr;
    }

    bool is_buffer1, is_buffer2;
    napi_is_buffer(env, args[0], &is_buffer1);
    napi_is_buffer(env, args[1], &is_buffer2);

    if (!is_buffer1 || !is_buffer2) {
        napi_throw_type_error(env, nullptr, "Arguments must be Buffers");
        return nullptr;
    }

    uint8_t* header_data;
    size_t header_length;
    status = napi_get_buffer_info(env, args[0], (void**)&header_data, &header_length);
    if (status != napi_ok || header_length != 80) {
        napi_throw_error(env, nullptr, "Block header must be exactly 80 bytes");
        return nullptr;
    }

    uint8_t* target_data;
    size_t target_length;
    status = napi_get_buffer_info(env, args[1], (void**)&target_data, &target_length);
    if (status != napi_ok || target_length != 32) {
        napi_throw_error(env, nullptr, "Target must be exactly 32 bytes");
        return nullptr;
    }

    yespower_binary_t output;
    int result = yespower_tls(header_data, header_length, &bitok_yespower_params, &output);

    if (result != 0) {
        napi_throw_error(env, nullptr, "Yespower hash computation failed");
        return nullptr;
    }

    bool is_valid = true;
    for (int i = 31; i >= 0; i--) {
        if (output.uc[i] < target_data[i]) {
            break;
        } else if (output.uc[i] > target_data[i]) {
            is_valid = false;
            break;
        }
    }

    napi_value result_value;
    status = napi_get_boolean(env, is_valid, &result_value);
    if (status != napi_ok) {
        napi_throw_error(env, nullptr, "Failed to create return value");
        return nullptr;
    }

    return result_value;
}

static napi_value Init(napi_env env, napi_value exports) {
    napi_status status;
    napi_value fn_hash, fn_verify;

    status = napi_create_function(env, nullptr, 0, Hash, nullptr, &fn_hash);
    if (status != napi_ok) return nullptr;

    status = napi_create_function(env, nullptr, 0, VerifyBlock, nullptr, &fn_verify);
    if (status != napi_ok) return nullptr;

    status = napi_set_named_property(env, exports, "hash", fn_hash);
    if (status != napi_ok) return nullptr;

    status = napi_set_named_property(env, exports, "verifyBlock", fn_verify);
    if (status != napi_ok) return nullptr;

    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
