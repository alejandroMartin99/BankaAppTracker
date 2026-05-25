import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environment';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent implements OnInit {
  errorMessage = '';
  loading = false;
  demoAvailable = false;

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]]
  });

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router
  ) {
    if (this.auth.isAuthenticated()) {
      this.router.navigate(['/gastos']);
    }
  }

  ngOnInit(): void {
    const localDemo =
      !environment.production &&
      !!(environment.demoEmail && environment.demoPassword);
    if (localDemo) {
      this.demoAvailable = true;
      return;
    }
    void this.auth.isDemoAvailable().then((ok) => {
      this.demoAvailable = ok;
    });
  }

  async onSubmit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.errorMessage = '';
    this.loading = true;
    const { email, password } = this.form.getRawValue();
    const { error } = await this.auth.signIn(email, password);
    this.loading = false;
    if (error) {
      this.errorMessage = error.message || 'Error al iniciar sesión';
      return;
    }
    this.router.navigate(['/gastos']);
  }

  async onDemo() {
    this.errorMessage = '';
    this.loading = true;
    const { error } = await this.auth.signInAsDemo();
    this.loading = false;
    if (error) {
      this.errorMessage = error.message || 'Modo demo no disponible';
      return;
    }
    this.router.navigate(['/gastos']);
  }
}
