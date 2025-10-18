---
layout: post
title: Myself become MCP
---

Until this blog is written, I actually still confuse about how MCP (Model Context Protocol) working behind the scene. MCP extend /v1/chat/completions that is available in most of LLM provider and provide several tools that LLM can use.

by default, we can use this data to ask LLM
{% highlight json %}
{
  "model": "qwen3-4b",
  "messages": [
    { 
        "role": "user",
        "content": "How are you doing?",
        "temperature": 0.1
    }
  ]
}
{% endhighlight %}

Let's says we want to build MCP server that can troubleshoot Kubernetes. MCP extend the API by provide "tools" in the data. I am asking LLM that I need LLM to troubleshoot my istio-proxy sidecar.

{% highlight json %}
{
  "model": "qwen3-4b",
  "messages": [
    {
      "role": "system",
      "content": "If you need more data to troubleshoot, you response must be have valid JSON object containing a 'tool_calls' array."
    },
    {
      "role": "user",
      "content": "My istio-proxy sidecar is failing in the billing-service-v1-abcdef pod in default namespace. please troubleshoot and find the root cause. you can use tools provided"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_kubernetes_pod_logs",
        "description": "Retrieves logs from a specific pod in a Kubernetes cluster. Useful for debugging crashes or errors.",
        "parameters": {
          "type": "object",
          "properties": {
            "namespace": {
              "type": "string",
              "description": "The Kubernetes namespace where the pod is located, e.g., '''default''', '''istio-system'''"
            },
            "pod_name": {
              "type": "string",
              "description": "The full name of the pod, e.g., '''my-app-7f5dcf7f9c-2q9k8'''"
            },
            "container_name": {
              "type": "string",
              "description": "The specific container within the pod to get logs from. Optional."
            }
          },
          "required": ["namespace", "pod_name"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "get_kubernetes_pod_memory_data",
        "description": "Retrieves the current memory usage, request, and limit of a specific pod in a Kubernetes cluster.",
        "parameters": {
          "type": "object",
          "properties": {
            "namespace": {
              "type": "string",
              "description": "The Kubernetes namespace where the pod is located, e.g., '''default''', '''istio-system'''"
            },
            "pod_name": {
              "type": "string",
              "description": "The full name of the pod, e.g., '''my-app-7f5dcf7f9c-2q9k8'''"
            },
            "container_name": {
              "type": "string",
              "description": "The specific container within the pod to get logs from. Optional."
            }
          },
          "required": ["namespace", "pod_name"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "get_kubernetes_pod_cpu_data",
        "description": "Retrieves the current cpu usage, request, and limit of a specific pod in a Kubernetes cluster.",
        "parameters": {
          "type": "object",
          "properties": {
            "namespace": {
              "type": "string",
              "description": "The Kubernetes namespace where the pod is located, e.g., '''default''', '''istio-system'''"
            },
            "pod_name": {
              "type": "string",
              "description": "The full name of the pod, e.g., '''my-app-7f5dcf7f9c-2q9k8'''"
            },
            "container_name": {
              "type": "string",
              "description": "The specific container within the pod to get logs from. Optional."
            }
          },
          "required": ["namespace", "pod_name"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "run_postgres_query",
        "description": "Executes a read-only SQL query against the PostgreSQL database.",
        "parameters": {
          "type": "object",
          "properties": {
            "sql_query": {
              "type": "string",
              "description": "The SQL SELECT statement to execute."
            }
          },
          "required": ["sql_query"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
{% endhighlight %}

This tell that LLM can response to MCP server and ask MCP server to execute the function to get more data to complete the troubleshooting. 

In this case, MCP server can provide several data
1. pod logs via get_kubernetes_pod_logs
2. run postgresql query via run_postgres_query
3. get pod cpu data via get_kubernetes_pod_cpu_data
4. get pod memory data via get_kubernetes_pod_memory_data

with the first request, LLM will response with this:
{% highlight json %}
{
  "created": 1760801343,
  "object": "chat.completion",
  "id": "e5d76aed-84fe-4d8f-8ae0-67f6ecd25b89",
  "model": "qwen3-4b",
  "choices": [
    {
      "index": 0,
      "finish_reason": "tool_calls",
      "message": {
        "role": "assistant",
        "content": "",
        "tool_calls": [
          {
            "index": 0,
            "id": "e5d76aed-84fe-4d8f-8ae0-67f6ecd25b89",
            "type": "function",
            "function": {
              "name": "get_kubernetes_pod_logs",
              "arguments": "{\"container_name\":\"istio-proxy\",\"namespace\":\"default\",\"pod_name\":\"billing-service-v1-abcdef\"}"
            }
          }
        ]
      }
    }
  ],
  "usage": {
    "prompt_tokens": 707,
    "completion_tokens": 42,
    "total_tokens": 749
  }
}
{% highlight json %}

If you check, LLM required another data which MCP need to get. LLM logic ask MCP to get the log of the pods. As an MCP, we can call Kubernetes API and get the logs of the pods. After we get the logs, we need to call LLM again and provide the data.

We add another data inside message informing LLM that function is already been called. There are 2 data:
1. role assistant says that function get_kubernetes_pod_logs has been called with the arguments
2. role tool have the response from the function.

{% highlight json %}
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-4b",
    "messages": [
      {
        "role": "system",
        "content": "If you need more data to troubleshoot, you response must be have valid JSON object containing a 'tool_calls' array."
      },
      {
        "role": "user",
        "content": "My istio-proxy sidecar is failing in the billing-service-v1-abcdef pod in default namespace. please troubleshoot and find the root cause. you can use tools provided"
      },

      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "e5d76aed-84fe-4d8f-8ae0-67f6ecd25b89",
            "type": "function",
            "function": {
              "name": "get_kubernetes_pod_logs",
              "arguments": "{\"container_name\":\"istio-proxy\",\"namespace\":\"default\",\"pod_name\":\"billing-service-v1-abcdef\"}"
            }
          }
        ]
      },
      {
        "role": "tool",
        "tool_call_id": "e5d76aed-84fe-4d8f-8ae0-67f6ecd25b89",
        "name": "get_kubernetes_pod_logs",
        "content": "{\"logs\": \"warn    Envoy may have been out of memory killed. Check memory usage and limits.; error    Epoch 0 exited with error: signal: killed\"}"
      }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_kubernetes_pod_logs",
          "description": "Retrieves logs from a specific pod in a Kubernetes cluster. Useful for debugging crashes or errors.",
          "parameters": {
            "type": "object",
            "properties": {
              "namespace": {
                "type": "string",
                "description": "The Kubernetes namespace where the pod is located, e.g., '''default''', '''istio-system'''"
              },
              "pod_name": {
                "type": "string",
                "description": "The full name of the pod, e.g., '''my-app-7f5dcf7f9c-2q9k8'''"
              },
              "container_name": {
                "type": "string",
                "description": "The specific container within the pod to get logs from. Optional."
              }
            },
            "required": ["namespace", "pod_name"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "get_kubernetes_pod_memory_data",
          "description": "Retrieves the current memory usage, request, and limit of a specific pod in a Kubernetes cluster.",
          "parameters": {
            "type": "object",
            "properties": {
              "namespace": {
                "type": "string",
                "description": "The Kubernetes namespace where the pod is located, e.g., '''default''', '''istio-system'''"
              },
              "pod_name": {
                "type": "string",
                "description": "The full name of the pod, e.g., '''my-app-7f5dcf7f9c-2q9k8'''"
              },
              "container_name": {
                "type": "string",
                "description": "The specific container within the pod to get logs from. Optional."
              }
            },
            "required": ["namespace", "pod_name"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "get_kubernetes_pod_cpu_data",
          "description": "Retrieves the current cpu usage, request, and limit of a specific pod in a Kubernetes cluster.",
          "parameters": {
            "type": "object",
            "properties": {
              "namespace": {
                "type": "string",
                "description": "The Kubernetes namespace where the pod is located, e.g., '''default''', '''istio-system'''"
              },
              "pod_name": {
                "type": "string",
                "description": "The full name of the pod, e.g., '''my-app-7f5dcf7f9c-2q9k8'''"
              },
              "container_name": {
                "type": "string",
                "description": "The specific container within the pod to get logs from. Optional."
              }
            },
            "required": ["namespace", "pod_name"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "run_postgres_query",
          "description": "Executes a read-only SQL query against the PostgreSQL database.",
          "parameters": {
            "type": "object",
            "properties": {
              "sql_query": {
                "type": "string",
                "description": "The SQL SELECT statement to execute."
              }
            },
            "required": ["sql_query"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'
{% endhighlight %}

LLM required another data to be fetch. This time, LLM decide to get the pod memory data by sending this reponse
{% highlight json %}
{
  "created": 1760801907,
  "object": "chat.completion",
  "id": "e76326e5-a29b-492f-bf72-8b42e23730a2",
  "model": "qwen3-4b",
  "choices": [
    {
      "index": 0,
      "finish_reason": "tool_calls",
      "message": {
        "role": "assistant",
        "content": "",
        "tool_calls": [
          {
            "index": 0,
            "id": "e76326e5-a29b-492f-bf72-8b42e23730a2",
            "type": "function",
            "function": {
              "name": "get_kubernetes_pod_memory_data",
              "arguments": "{\"container_name\":\"istio-proxy\",\"namespace\":\"default\",\"pod_name\":\"billing-service-v1-abcdef\"}"
            }
          }
        ]
      }
    }
  ],
  "usage": {
    "prompt_tokens": 832,
    "completion_tokens": 42,
    "total_tokens": 874
  }
}
{% endhighlight %}

As MCP server, our job is execute the order from LLM, let's call Kubernetes API and get the data related to memory. After those, send back to LLM
{% highlight json %}
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-4b",
    "messages": [
      {
        "role": "system",
        "content": "If you need more data to troubleshoot, you response must be have valid JSON object containing a 'tool_calls' array."
      },
      {
        "role": "user",
        "content": "My istio-proxy sidecar is failing in the billing-service-v1-abcdef pod in default namespace. please troubleshoot and find the root cause. you can use tools provided"
      },

      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "e5d76aed-84fe-4d8f-8ae0-67f6ecd25b89",
            "type": "function",
            "function": {
              "name": "get_kubernetes_pod_logs",
              "arguments": "{\"container_name\":\"istio-proxy\",\"namespace\":\"default\",\"pod_name\":\"billing-service-v1-abcdef\"}"
            }
          }
        ]
      },
      {
        "role": "tool",
        "tool_call_id": "e5d76aed-84fe-4d8f-8ae0-67f6ecd25b89",
        "name": "get_kubernetes_pod_logs",
        "content": "{\"logs\": \"warn    Envoy may have been out of memory killed. Check memory usage and limits.; error    Epoch 0 exited with error: signal: killed\"}"
      },

      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "e76326e5-a29b-492f-bf72-8b42e23730a2",
            "type": "function",
            "function": {
              "name": "get_kubernetes_pod_memory_data",
              "arguments": "{\"container_name\":\"istio-proxy\",\"namespace\":\"default\",\"pod_name\":\"billing-service-v1-abcdef\"}"
            }
          }
        ]
      },
      {
        "role": "tool",
        "tool_call_id": "e76326e5-a29b-492f-bf72-8b42e23730a2",
        "name": "get_kubernetes_pod_memory_data",
        "content": "{\"usage\": \"1Gi\", \"request\": \"512Mi\", \"limit\": \"1Gi\"}"
      }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_kubernetes_pod_logs",
          "description": "Retrieves logs from a specific pod in a Kubernetes cluster. Useful for debugging crashes or errors.",
          "parameters": {
            "type": "object",
            "properties": {
              "namespace": {
                "type": "string",
                "description": "The Kubernetes namespace where the pod is located, e.g., '''default''', '''istio-system'''"
              },
              "pod_name": {
                "type": "string",
                "description": "The full name of the pod, e.g., '''my-app-7f5dcf7f9c-2q9k8'''"
              },
              "container_name": {
                "type": "string",
                "description": "The specific container within the pod to get logs from. Optional."
              }
            },
            "required": ["namespace", "pod_name"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "get_kubernetes_pod_memory_data",
          "description": "Retrieves the current memory usage, request, and limit of a specific pod in a Kubernetes cluster.",
          "parameters": {
            "type": "object",
            "properties": {
              "namespace": {
                "type": "string",
                "description": "The Kubernetes namespace where the pod is located, e.g., '''default''', '''istio-system'''"
              },
              "pod_name": {
                "type": "string",
                "description": "The full name of the pod, e.g., '''my-app-7f5dcf7f9c-2q9k8'''"
              },
              "container_name": {
                "type": "string",
                "description": "The specific container within the pod to get logs from. Optional."
              }
            },
            "required": ["namespace", "pod_name"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "get_kubernetes_pod_cpu_data",
          "description": "Retrieves the current cpu usage, request, and limit of a specific pod in a Kubernetes cluster.",
          "parameters": {
            "type": "object",
            "properties": {
              "namespace": {
                "type": "string",
                "description": "The Kubernetes namespace where the pod is located, e.g., '''default''', '''istio-system'''"
              },
              "pod_name": {
                "type": "string",
                "description": "The full name of the pod, e.g., '''my-app-7f5dcf7f9c-2q9k8'''"
              },
              "container_name": {
                "type": "string",
                "description": "The specific container within the pod to get logs from. Optional."
              }
            },
            "required": ["namespace", "pod_name"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "run_postgres_query",
          "description": "Executes a read-only SQL query against the PostgreSQL database.",
          "parameters": {
            "type": "object",
            "properties": {
              "sql_query": {
                "type": "string",
                "description": "The SQL SELECT statement to execute."
              }
            },
            "required": ["sql_query"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'
{% endhighlight %}

Depends on the model, this data should be the last, but somehow our model ask related data for CPU as well.
{% highlight json %}
{
  "created": 1760802094,
  "object": "chat.completion",
  "id": "15ac55e4-721b-450a-b53e-f817b2076883",
  "model": "qwen3-4b",
  "choices": [
    {
      "index": 0,
      "finish_reason": "tool_calls",
      "message": {
        "role": "assistant",
        "content": "",
        "tool_calls": [
          {
            "index": 0,
            "id": "15ac55e4-721b-450a-b53e-f817b2076883",
            "type": "function",
            "function": {
              "name": "get_kubernetes_pod_cpu_data",
              "arguments": "{\"container_name\":\"istio-proxy\",\"namespace\":\"default\",\"pod_name\":\"billing-service-v1-abcdef\"}"
            }
          }
        ]
      }
    }
  ],
  "usage": {
    "prompt_tokens": 950,
    "completion_tokens": 43,
    "total_tokens": 993
  }
}
{% endhighlight %}

Since MCP follow any guide from LLM, let's get the CPU data as well and provide to LLM.
{% highlight json %}
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-4b",
    "messages": [
      {
        "role": "system",
        "content": "If you need more data to troubleshoot, you response must be have valid JSON object containing a 'tool_calls' array."
      },
      {
        "role": "user",
        "content": "My istio-proxy sidecar is failing in the billing-service-v1-abcdef pod in default namespace. please troubleshoot and find the root cause. you can use tools provided"
      },

      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "e5d76aed-84fe-4d8f-8ae0-67f6ecd25b89",
            "type": "function",
            "function": {
              "name": "get_kubernetes_pod_logs",
              "arguments": "{\"container_name\":\"istio-proxy\",\"namespace\":\"default\",\"pod_name\":\"billing-service-v1-abcdef\"}"
            }
          }
        ]
      },
      {
        "role": "tool",
        "tool_call_id": "e5d76aed-84fe-4d8f-8ae0-67f6ecd25b89",
        "name": "get_kubernetes_pod_logs",
        "content": "{\"logs\": \"warn    Envoy may have been out of memory killed. Check memory usage and limits.; error    Epoch 0 exited with error: signal: killed\"}"
      },

      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "e76326e5-a29b-492f-bf72-8b42e23730a2",
            "type": "function",
            "function": {
              "name": "get_kubernetes_pod_memory_data",
              "arguments": "{\"container_name\":\"istio-proxy\",\"namespace\":\"default\",\"pod_name\":\"billing-service-v1-abcdef\"}"
            }
          }
        ]
      },
      {
        "role": "tool",
        "tool_call_id": "e76326e5-a29b-492f-bf72-8b42e23730a2",
        "name": "get_kubernetes_pod_memory_data",
        "content": "{\"usage\": \"1Gi\", \"request\": \"512Mi\", \"limit\": \"1Gi\"}"
      },

      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "15ac55e4-721b-450a-b53e-f817b2076883",
            "type": "function",
            "function": {
              "name": "get_kubernetes_pod_cpu_data",
              "arguments": "{\"container_name\":\"istio-proxy\",\"namespace\":\"default\",\"pod_name\":\"billing-service-v1-abcdef\"}"
            }
          }
        ]
      },
      {
        "role": "tool",
        "tool_call_id": "15ac55e4-721b-450a-b53e-f817b2076883",
        "name": "get_kubernetes_pod_cpu_data",
        "content": "{\"usage\": \"104m\", \"request\": \"512m\", \"limit\": \"1024m\"}"
      } 
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_kubernetes_pod_logs",
          "description": "Retrieves logs from a specific pod in a Kubernetes cluster. Useful for debugging crashes or errors.",
          "parameters": {
            "type": "object",
            "properties": {
              "namespace": {
                "type": "string",
                "description": "The Kubernetes namespace where the pod is located, e.g., '''default''', '''istio-system'''"
              },
              "pod_name": {
                "type": "string",
                "description": "The full name of the pod, e.g., '''my-app-7f5dcf7f9c-2q9k8'''"
              },
              "container_name": {
                "type": "string",
                "description": "The specific container within the pod to get logs from. Optional."
              }
            },
            "required": ["namespace", "pod_name"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "get_kubernetes_pod_memory_data",
          "description": "Retrieves the current memory usage, request, and limit of a specific pod in a Kubernetes cluster.",
          "parameters": {
            "type": "object",
            "properties": {
              "namespace": {
                "type": "string",
                "description": "The Kubernetes namespace where the pod is located, e.g., '''default''', '''istio-system'''"
              },
              "pod_name": {
                "type": "string",
                "description": "The full name of the pod, e.g., '''my-app-7f5dcf7f9c-2q9k8'''"
              },
              "container_name": {
                "type": "string",
                "description": "The specific container within the pod to get logs from. Optional."
              }
            },
            "required": ["namespace", "pod_name"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "get_kubernetes_pod_cpu_data",
          "description": "Retrieves the current cpu usage, request, and limit of a specific pod in a Kubernetes cluster.",
          "parameters": {
            "type": "object",
            "properties": {
              "namespace": {
                "type": "string",
                "description": "The Kubernetes namespace where the pod is located, e.g., '''default''', '''istio-system'''"
              },
              "pod_name": {
                "type": "string",
                "description": "The full name of the pod, e.g., '''my-app-7f5dcf7f9c-2q9k8'''"
              },
              "container_name": {
                "type": "string",
                "description": "The specific container within the pod to get logs from. Optional."
              }
            },
            "required": ["namespace", "pod_name"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "run_postgres_query",
          "description": "Executes a read-only SQL query against the PostgreSQL database.",
          "parameters": {
            "type": "object",
            "properties": {
              "sql_query": {
                "type": "string",
                "description": "The SQL SELECT statement to execute."
              }
            },
            "required": ["sql_query"]
          }
        }
      }
    ],
    "tool_choice": "auto"
  }'
{% endhighlight %}


Finally, process is complete and LLM can actually figure out what is happen with our Pods. It will not ask MCP where there are no reponse with tool_calls

{% highlight json %}
{
  "created": 1760802291,
  "object": "chat.completion",
  "id": "4c8c3012-f708-4524-bf0e-a73e9b79cad0",
  "model": "qwen3-4b",
  "choices": [
    {
      "index": 0,
      "finish_reason": "tool_calls",
      "message": {
        "role": "assistant",
        "content": "The istio-proxy sidecar in the billing-service-v1-abcdef pod is failing due to out-of-memory (OOM) conditions. The pod is using 1Gi of memory, which is at the limit of 1Gi. The CPU usage is at 104m, which is within the 512m request and 1024m limit. The logs indicate that the pod was killed due to memory issues. To resolve this, increase the memory limit or check for memory leaks in the sidecar container."
      }
    }
  ],
  "usage": {
    "prompt_tokens": 1072,
    "completion_tokens": 126,
    "total_tokens": 1198
  }
}
{% endhighlight %}

In short, MCP will provide LLM what all capability/function that MCP have, but the decision which capability/function that will be executed is on LLM itself.