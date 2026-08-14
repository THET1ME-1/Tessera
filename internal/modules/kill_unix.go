//go:build unix

package modules

import (
	"os/exec"
	"syscall"
	"time"
)

// оборвать настраивает жёсткое прекращение модуля по таймауту.
//
// Мало убить саму программу: если модуль запускает потомков (а `sh main.sh`
// запускает), они наследуют её вывод и держат его открытым. Ожидание тогда
// тянется до конца потомка, и таймаут в пять секунд превращается в тридцать.
// Поэтому процесс уходит в свою группу, а по сроку убивается вся группа.
func оборвать(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	// Подстраховка на случай, если кто-то всё же удержал вывод.
	cmd.WaitDelay = time.Second
}
