// Deploys compiled contracts in go-qrl's VM and calls their test functions.
// Built inside a go-qrl checkout through a build overlay; see scripts/test-vm.js.
//
// stdin:  [{"name": "…", "bytecode": "0x…", "tests": [{"name": "…", "selector": "0x…"}]}]
// stdout: [{"contract": "…", "test": "…", "ok": true, "output": "0x…", "error": "", "topics": ["0x…"]}]
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/theQRL/go-qrl/common"
	"github.com/theQRL/go-qrl/common/hexutil"
	"github.com/theQRL/go-qrl/core/vm/runtime"
)

type test struct {
	Name     string `json:"name"`
	Selector string `json:"selector"`
}

type contract struct {
	Name     string `json:"name"`
	Bytecode string `json:"bytecode"`
	Tests    []test `json:"tests"`
}

type result struct {
	Contract string   `json:"contract"`
	Test     string   `json:"test"`
	Ok       bool     `json:"ok"`
	Output   string   `json:"output"`
	Error    string   `json:"error"`
	Topics   []string `json:"topics"`
}

const gasLimit = 30_000_000

func run(c contract, t test) result {
	res := result{Contract: c.Name, Test: t.Name, Topics: []string{}}
	// Every test gets its own deployment on empty state.
	cfg := &runtime.Config{GasLimit: gasLimit}
	_, address, _, err := runtime.Create(common.FromHex(c.Bytecode), cfg)
	if err != nil {
		res.Error = "deploy: " + err.Error()
		return res
	}
	output, _, err := runtime.Call(address, common.FromHex(t.Selector), cfg)
	res.Output = hexutil.Encode(output)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	for _, l := range cfg.State.Logs() {
		if len(l.Topics) > 0 {
			res.Topics = append(res.Topics, hexutil.Encode(l.Topics[0][:]))
		}
	}
	res.Ok = true
	return res
}

func main() {
	var contracts []contract
	if err := json.NewDecoder(os.Stdin).Decode(&contracts); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	results := []result{}
	for _, c := range contracts {
		for _, t := range c.Tests {
			results = append(results, run(c, t))
		}
	}
	if err := json.NewEncoder(os.Stdout).Encode(results); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
